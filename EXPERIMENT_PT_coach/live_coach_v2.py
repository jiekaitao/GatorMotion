#!/usr/bin/env python3
"""PT Coach v2: skeleton overlay + divergence-based coaching.

Approach:
  1. Detect user pose (MediaPipe 33 landmarks)
  2. Normalize to body frame (pelvis origin, hip-width scale)
  3. Find best-matching reference frame (nearest neighbor)
  4. Compute per-joint divergence vectors
  5. Visualize: overlay reference skeleton on user + colored divergence lines
  6. Coach: generate text feedback only when joint divergence > threshold
"""

from __future__ import annotations

import argparse
import json
import math
import time
from collections import deque
from pathlib import Path
from typing import Any

import cv2
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for rendering to numpy
import matplotlib.pyplot as plt
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    PoseLandmarker,
    PoseLandmarkerOptions,
    PoseLandmarksConnections,
    RunningMode,
)

from pt_coach.common import (
    ALIGNMENT_LANDMARKS,
    LANDMARK_INDEX,
    FEATURE_LANDMARKS,
    SIDE_BY_INDEX,
    PART_BY_INDEX,
    feature_vector,
    knee_angles_deg,
    landmarks_list_to_np,
    load_reference_json,
    mediapipe_landmarks_to_np,
    moving_average,
    normalize_to_body_frame,
    correction_landmarks_for_exercise,
    procrustes_align_2d,
)
from pt_coach.exercises import available_exercises, get_exercise_spec

POSE_CONNECTIONS = [
    (int(conn.start), int(conn.end)) for conn in PoseLandmarksConnections.POSE_LANDMARKS
]

# Joints relevant for skeleton drawing (skip face landmarks for cleaner overlay).
BODY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
BODY_CONNECTIONS = [(a, b) for a, b in POSE_CONNECTIONS if a >= 11 and b >= 11]


class CoachV2Engine:
    """Simple divergence-based coaching engine.

    No temporal windowing, no EMA, no hysteresis.
    Just: match frame -> measure divergence -> coach if above threshold.
    """

    def __init__(self, model_npz: Path, metadata_json: Path):
        model = np.load(model_npz)
        self.ref_norm = model["ref_norm"]  # (N, 33, 3)
        self.ref_features_scaled = model["ref_features_scaled"]  # (N, D)
        self.feat_mean = model["feat_mean"]
        self.feat_std = model["feat_std"]

        meta = json.loads(metadata_json.read_text(encoding="utf-8"))
        self.meta = meta
        self.feature_landmarks = [int(i) for i in meta["feature_landmarks"]]
        self.correction_landmarks = [int(i) for i in meta["correction_landmarks"]]
        self.dist_cal = meta["distance_calibration"]

        # Coaching threshold: divergence (in body-frame units) above which we coach.
        # 0.15 hip-widths ≈ 4-5cm for an average person.
        self.coach_threshold = 0.12

        # Quality smoothing
        self.quality_hist: deque[float] = deque(maxlen=12)

        # RMS history for graphing improvement over time
        # Store (timestamp_sec, rms_divergence) tuples
        self.rms_history: deque[tuple[float, float]] = deque(maxlen=300)  # ~10 sec @ 30fps

        # Rep counting
        self.rep_count = 0
        self.rep_state = "standing"
        self.knee_hist: deque[float] = deque(maxlen=10)

    def _scale_feature(self, feat: np.ndarray) -> np.ndarray:
        return (feat - self.feat_mean) / self.feat_std

    def _match_frame(self, feat_scaled: np.ndarray) -> tuple[int, float]:
        """Nearest-neighbor match. Returns (ref_index, distance)."""
        d = np.linalg.norm(self.ref_features_scaled - feat_scaled[None, :], axis=1)
        idx = int(np.argmin(d))
        return idx, float(d[idx])

    def _quality_from_distance(self, d: float) -> float:
        p50 = float(self.dist_cal["p50"])
        p99 = float(self.dist_cal["p99"])
        denom = max(1e-6, p99 - p50)
        quality = 1.0 - ((d - p50) / denom)
        return float(np.clip(quality, 0.0, 1.0))

    def _update_reps(self, knee_avg: float) -> None:
        self.knee_hist.append(knee_avg)
        k = moving_average(list(self.knee_hist), 5)
        if self.rep_state == "standing" and k < 125:
            self.rep_state = "down"
        elif self.rep_state == "down" and k > 160:
            self.rep_state = "standing"
            self.rep_count += 1

    def _direction_text(self, dx: float, dy: float) -> str:
        """Convert body-frame delta to human-readable direction."""
        dirs = []
        if abs(dx) > 0.03:
            dirs.append("right" if dx > 0 else "left")
        if abs(dy) > 0.03:
            dirs.append("down" if dy > 0 else "up")
        return " and ".join(dirs) if dirs else "closer"

    def infer(self, landmarks_xyzw: np.ndarray, timestamp_sec: float | None = None) -> dict[str, Any]:
        """Run inference on a single frame.

        Args:
            landmarks_xyzw: 33x4 array of landmarks (x, y, z, visibility)
            timestamp_sec: Optional timestamp in seconds for RMS history tracking

        Returns a payload with: matched reference, per-joint divergences,
        quality score, coaching messages.
        """
        norm, frame_info = normalize_to_body_frame(landmarks_xyzw)
        feat = feature_vector(norm, self.feature_landmarks)
        feat_scaled = self._scale_feature(feat)

        ref_idx, dist = self._match_frame(feat_scaled)
        ref = self.ref_norm[ref_idx]

        quality = self._quality_from_distance(dist)
        self.quality_hist.append(quality)
        quality_smooth = moving_average(list(self.quality_hist), 8)

        left_knee, right_knee, knee_avg = knee_angles_deg(norm)
        self._update_reps(knee_avg)

        # Extract body-frame axes for image-space projection
        pelvis = frame_info["pelvis"]
        x_axis = frame_info["x_axis"]
        y_axis = frame_info["y_axis"]
        scale = float(frame_info["scale"][0])

        # --- Procrustes alignment: rotate+scale the reference to best match the user ---
        # Use major body landmarks (shoulders, hips, knees, ankles) for alignment.
        # This makes the comparison rotation-invariant: if the user is turned slightly
        # relative to the reference person, Procrustes removes that rotation first.
        align_indices = [i for i in ALIGNMENT_LANDMARKS if float(landmarks_xyzw[i, 3]) > 0.5]
        if len(align_indices) >= 4:
            user_align = norm[align_indices, :2]
            ref_align = ref[align_indices, :2]
            _, rot, proc_scale, proc_trans = procrustes_align_2d(user_align, ref_align)

            # Apply Procrustes transform to ALL 33 reference landmarks
            ref_aligned = np.zeros_like(ref[:, :2])
            for i in range(33):
                ref_aligned[i] = proc_scale * (ref[i, :2] @ rot.T) + proc_trans
        else:
            # Not enough visible landmarks — fall back to raw body-frame comparison
            ref_aligned = ref[:, :2].copy()
            rot = np.eye(2, dtype=np.float32)
            proc_scale = 1.0

        # Compute per-joint divergence (on Procrustes-aligned coordinates)
        divergences: list[dict[str, Any]] = []
        coaching: list[dict[str, Any]] = []
        total_div_sq = 0.0
        n_visible = 0

        for idx in self.correction_landmarks:
            vis = float(landmarks_xyzw[idx, 3])
            if vis < 0.5:
                continue

            # Divergence after Procrustes alignment
            user_xy = norm[idx, :2]
            aligned_ref_xy = ref_aligned[idx]
            delta = user_xy - aligned_ref_xy
            div_dist = float(np.linalg.norm(delta))
            total_div_sq += div_dist ** 2
            n_visible += 1

            # Image-space endpoints for visualization
            user_img = landmarks_xyzw[idx, :2]
            # Project aligned reference point back to image space
            ref_img = (pelvis
                       + float(aligned_ref_xy[0]) * scale * x_axis
                       + float(aligned_ref_xy[1]) * scale * y_axis)

            side = SIDE_BY_INDEX.get(idx, "")
            part = PART_BY_INDEX.get(idx, "")

            div_entry = {
                "landmark_idx": int(idx),
                "side": side,
                "part": part,
                "distance": round(div_dist, 4),
                "delta_x": round(float(delta[0]), 4),
                "delta_y": round(float(delta[1]), 4),
                "user_img_xy": [round(float(user_img[0]), 4), round(float(user_img[1]), 4)],
                "ref_img_xy": [round(float(ref_img[0]), 4), round(float(ref_img[1]), 4)],
                "visibility": round(vis, 3),
            }
            divergences.append(div_entry)

            # Coach only above threshold
            if div_dist > self.coach_threshold:
                direction = self._direction_text(float(delta[0]), float(delta[1]))
                magnitude = "slightly" if div_dist < 0.20 else ("" if div_dist < 0.35 else "more")
                msg = f"Move your {side} {part} {direction}"
                if magnitude:
                    msg += f" {magnitude}"
                msg = msg.strip().replace("  ", " ") + "."

                coaching.append({
                    "landmark_idx": int(idx),
                    "side": side,
                    "part": part,
                    "text": msg,
                    "divergence": round(div_dist, 4),
                })

        rms_div = math.sqrt(total_div_sq / max(1, n_visible))

        # Track RMS over time for graphing
        if timestamp_sec is not None:
            self.rms_history.append((float(timestamp_sec), float(rms_div)))

        # Sort coaching by divergence (worst first)
        coaching.sort(key=lambda c: c["divergence"], reverse=True)

        visibility = float(np.mean(landmarks_xyzw[[11, 12, 23, 24, 25, 26, 27, 28], 3]))

        # Build reference skeleton image points for overlay (Procrustes-aligned)
        ref_skeleton_img: list[list[float]] = []
        for i in range(33):
            axy = ref_aligned[i]
            img_pt = pelvis + float(axy[0]) * scale * x_axis + float(axy[1]) * scale * y_axis
            ref_skeleton_img.append([round(float(img_pt[0]), 4), round(float(img_pt[1]), 4)])

        return {
            "exercise": {
                "name": self.meta.get("exercise_name", "unknown"),
                "display_name": self.meta.get("exercise_display_name", "Unknown"),
                "rep": int(self.rep_count),
                "reference_frame": int(ref_idx),
            },
            "quality": {
                "score": round(float(quality_smooth), 3),
                "confidence": round(float(np.clip(visibility, 0.0, 1.0)), 3),
                "distance": round(float(dist), 4),
                "rms_divergence": round(float(rms_div), 4),
            },
            "procrustes": {
                "scale": round(float(proc_scale), 4),
                "rotation_deg": round(float(np.degrees(np.arctan2(rot[1, 0], rot[0, 0]))), 2),
                "alignment_landmarks_used": len(align_indices),
            },
            "divergences": divergences,
            "coaching": coaching,
            "ref_skeleton_img": ref_skeleton_img,
        }


# ---------------------------------------------------------------------------
# Visualization
# ---------------------------------------------------------------------------

def _color_from_divergence(div: float, threshold: float) -> tuple[int, int, int]:
    """Green when close, yellow at threshold, red when far."""
    ratio = div / max(threshold, 1e-6)
    if ratio < 0.5:
        return (80, 220, 80)   # green
    if ratio < 1.0:
        return (80, 220, 220)  # yellow-green
    if ratio < 2.0:
        return (0, 180, 255)   # orange
    return (60, 60, 255)       # red


def draw_user_skeleton(frame: np.ndarray, lms: np.ndarray, mirror: bool = False) -> None:
    """Draw the user's pose skeleton in green."""
    h, w = frame.shape[:2]
    pts = []
    for i in range(33):
        x = float(lms[i, 0])
        if mirror:
            x = 1.0 - x
        px = int(np.clip(x, 0, 1) * (w - 1))
        py = int(np.clip(float(lms[i, 1]), 0, 1) * (h - 1))
        vis = float(lms[i, 3])
        pts.append((px, py, vis))

    for a, b in BODY_CONNECTIONS:
        if pts[a][2] < 0.3 or pts[b][2] < 0.3:
            continue
        cv2.line(frame, pts[a][:2], pts[b][:2], (80, 220, 80), 2, cv2.LINE_AA)

    for i in BODY_JOINTS:
        if pts[i][2] < 0.3:
            continue
        cv2.circle(frame, pts[i][:2], 4, (80, 255, 80), -1)


def draw_reference_skeleton(
    frame: np.ndarray,
    ref_skeleton_img: list[list[float]],
    ref_norm: np.ndarray,
    mirror: bool = False,
    alpha: float = 0.6,
) -> None:
    """Draw the reference skeleton as a semi-transparent ghost overlay."""
    h, w = frame.shape[:2]
    overlay = frame.copy()

    pts = []
    for i, (rx, ry) in enumerate(ref_skeleton_img):
        x = float(rx)
        if mirror:
            x = 1.0 - x
        px = int(np.clip(x, 0, 1) * (w - 1))
        py = int(np.clip(float(ry), 0, 1) * (h - 1))
        pts.append((px, py))

    for a, b in BODY_CONNECTIONS:
        cv2.line(overlay, pts[a], pts[b], (255, 160, 60), 2, cv2.LINE_AA)

    for i in BODY_JOINTS:
        cv2.circle(overlay, pts[i], 4, (255, 180, 80), -1)

    cv2.addWeighted(overlay, 1.0 - alpha, frame, alpha, 0, frame)


def draw_divergence_lines(
    frame: np.ndarray,
    divergences: list[dict[str, Any]],
    threshold: float,
    mirror: bool = False,
) -> None:
    """Draw colored line segments from user joint to reference joint position."""
    h, w = frame.shape[:2]

    for div in divergences:
        u = div["user_img_xy"]
        r = div["ref_img_xy"]
        ux, uy = float(u[0]), float(u[1])
        rx, ry = float(r[0]), float(r[1])
        if mirror:
            ux = 1.0 - ux
            rx = 1.0 - rx

        p_user = (int(np.clip(ux, 0, 1) * (w - 1)), int(np.clip(uy, 0, 1) * (h - 1)))
        p_ref = (int(np.clip(rx, 0, 1) * (w - 1)), int(np.clip(ry, 0, 1) * (h - 1)))

        color = _color_from_divergence(div["distance"], threshold)
        thickness = 2 if div["distance"] < threshold else 3
        cv2.line(frame, p_user, p_ref, color, thickness, cv2.LINE_AA)

        # Small circle at reference endpoint
        cv2.circle(frame, p_ref, 5, color, 1, cv2.LINE_AA)

        # Label
        if div["distance"] > threshold * 0.5:
            label = f"{div['side']} {div['part']} {div['distance']:.2f}"
            cv2.putText(frame, label, (p_user[0] + 6, p_user[1] - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1, cv2.LINE_AA)


def render_rms_graph(rms_history: deque[tuple[float, float]], threshold: float, width: int = 600, height: int = 300) -> np.ndarray:
    """Render a time-series graph of RMS divergence showing improvement over time.

    Args:
        rms_history: deque of (timestamp_sec, rms_divergence) tuples
        threshold: Coaching threshold to draw as reference line
        width: Graph width in pixels
        height: Graph height in pixels

    Returns:
        BGR image of the graph
    """
    if len(rms_history) < 2:
        # Not enough data — return blank graph
        blank = np.zeros((height, width, 3), dtype=np.uint8)
        blank[:] = (18, 18, 22)
        cv2.putText(blank, "Collecting RMS data...", (width // 4, height // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (180, 180, 180), 2, cv2.LINE_AA)
        return blank

    # Extract timestamps and RMS values
    times = np.array([t for t, _ in rms_history], dtype=np.float64)
    rms_vals = np.array([r for _, r in rms_history], dtype=np.float64)

    # Relative time (start at 0)
    times = times - times[0]

    # Create matplotlib figure
    fig, ax = plt.subplots(figsize=(width / 100, height / 100), dpi=100)
    fig.patch.set_facecolor('#121216')
    ax.set_facecolor('#1a1a1e')

    # Plot RMS over time
    ax.plot(times, rms_vals, color='#02caca', linewidth=2.5, label='RMS Divergence')

    # Threshold line
    ax.axhline(y=threshold, color='#ff6b6b', linestyle='--', linewidth=2, alpha=0.7, label='Coaching Threshold')

    # Moving average (smoothed trend)
    if len(rms_vals) >= 10:
        window = min(30, len(rms_vals) // 3)
        smoothed = np.convolve(rms_vals, np.ones(window) / window, mode='valid')
        smooth_times = times[window // 2 : len(smoothed) + window // 2]
        ax.plot(smooth_times, smoothed, color='#58CC02', linewidth=2, alpha=0.8, label='Trend (smoothed)')

    # Styling
    ax.set_xlabel('Time (seconds)', color='#e0e0e0', fontsize=11, fontweight='bold')
    ax.set_ylabel('RMS Divergence', color='#e0e0e0', fontsize=11, fontweight='bold')
    ax.set_title('Form Quality Over Time', color='#02caca', fontsize=13, fontweight='bold', pad=12)
    ax.tick_params(colors='#c0c0c0', labelsize=9)
    ax.grid(True, alpha=0.15, color='#606060')
    ax.legend(loc='upper right', fontsize=9, framealpha=0.9, facecolor='#2a2a2e', edgecolor='#404040', labelcolor='#e0e0e0')

    # Tight layout
    fig.tight_layout(pad=1.5)

    # Render to numpy array
    fig.canvas.draw()
    buf = np.frombuffer(fig.canvas.buffer_rgba(), dtype=np.uint8)
    buf = buf.reshape(fig.canvas.get_width_height()[::-1] + (4,))
    bgr = cv2.cvtColor(buf, cv2.COLOR_RGBA2BGR)
    plt.close(fig)

    return bgr


def render_info_panel(frame: np.ndarray, payload: dict[str, Any], threshold: float) -> np.ndarray:
    """Render a side panel with loss breakdown and coaching messages."""
    h, w = frame.shape[:2]
    panel_w = 350
    panel = np.zeros((h, panel_w, 3), dtype=np.uint8)
    panel[:] = (18, 18, 22)

    y = 30
    lh = 22

    def put(text: str, color=(230, 230, 230), scale=0.55, thick=1):
        nonlocal y
        cv2.putText(panel, text, (12, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thick, cv2.LINE_AA)
        y += lh

    ex = payload["exercise"]
    q = payload["quality"]
    put(f"PT Coach v2 - {ex['display_name']}", (120, 230, 255), 0.65, 2)
    put(f"Rep: {ex['rep']}    Ref frame: {ex['reference_frame']}")

    rms = q["rms_divergence"]
    rms_color = (80, 255, 80) if rms < threshold else (0, 200, 255) if rms < threshold * 2 else (80, 80, 255)
    put(f"RMS Divergence: {rms:.3f}", rms_color, 0.6, 2)
    put(f"Quality: {q['score']:.2f}    Conf: {q['confidence']:.2f}", (180, 255, 180))
    put(f"Threshold: {threshold:.3f}", (140, 140, 150))

    y += 10
    cv2.line(panel, (10, y), (panel_w - 10, y), (70, 70, 70), 1)
    y += 20

    # Per-joint divergence breakdown
    put("Joint Divergences:", (255, 210, 120), 0.58, 2)
    for div in sorted(payload["divergences"], key=lambda d: d["distance"], reverse=True):
        if y > h - 160:
            break
        d = div["distance"]
        color = _color_from_divergence(d, threshold)
        bar_len = min(int(d / (threshold * 3) * 120), 120)
        label = f"{div['side']:5s} {div['part']:6s}: {d:.3f}"
        put(label, color, 0.48)
        # Mini bar
        cv2.rectangle(panel, (200, y - 14), (200 + bar_len, y - 4), color, -1)

    y += 10
    cv2.line(panel, (10, y), (panel_w - 10, y), (70, 70, 70), 1)
    y += 20

    # Coaching messages
    coaching = payload.get("coaching", [])
    put("Coaching:", (255, 210, 120), 0.58, 2)
    if coaching:
        for i, c in enumerate(coaching[:5]):
            if y > h - 40:
                break
            color = (110, 215, 255) if i == 0 else (200, 200, 210)
            put(f"{c['text']} ({c['divergence']:.2f})", color, 0.48)
    else:
        put("Looking good!", (120, 255, 120), 0.58, 2)

    return np.concatenate([frame, panel], axis=1)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def open_pose_landmarker(model_path: Path) -> PoseLandmarker:
    return PoseLandmarker.create_from_options(
        PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="PT Coach v2 — divergence-based coaching")
    parser.add_argument("--exercise", default="squat", choices=available_exercises())
    parser.add_argument("--model", default="")
    parser.add_argument("--metadata", default="")
    parser.add_argument("--pose-model", default="models/pose_landmarker_heavy.task")
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--mirror", action="store_true")
    parser.add_argument("--threshold", type=float, default=0.12,
                        help="Coaching threshold in body-frame units (default 0.12 ≈ 4cm)")
    parser.add_argument("--json-out", default="outputs/live_state_v2.json")
    parser.add_argument("--source-json", default="", help="Replay landmarks instead of webcam")
    parser.add_argument("--no-window", action="store_true")
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument("--print-every", type=int, default=10)
    args = parser.parse_args()

    spec = get_exercise_spec(args.exercise)
    model_path = Path(args.model) if args.model else Path(f"models/{spec.key}_reference_model.npz")
    metadata_path = Path(args.metadata) if args.metadata else Path(f"models/{spec.key}_reference_model.meta.json")
    pose_model_path = Path(args.pose_model)
    json_out = Path(args.json_out)
    json_out.parent.mkdir(parents=True, exist_ok=True)

    engine = CoachV2Engine(model_path, metadata_path)
    engine.coach_threshold = args.threshold

    # Input source
    replayer = None
    cap = None
    landmarker = None

    if args.source_json:
        data = load_reference_json(Path(args.source_json))
        replay_frames = [landmarks_list_to_np(f["landmarks"]) for f in data["frames"]]
        replay_fps = float(data.get("fps", 15.0))
        replay_idx = 0
        print(f"Replay mode: {args.source_json} ({len(replay_frames)} frames @ {replay_fps}fps)")
    else:
        if not pose_model_path.exists():
            raise FileNotFoundError(f"Pose model missing: {pose_model_path}")
        landmarker = open_pose_landmarker(pose_model_path)
        cap = cv2.VideoCapture(args.camera)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open camera {args.camera}")
        print(f"Camera mode (index={args.camera})")

    frame_count = 0
    start_ts = time.time()

    try:
        while True:
            landmarks_xyzw = None
            frame = None
            current_ts_sec = time.time() - start_ts  # Relative timestamp in seconds

            if args.source_json:
                if replay_idx >= len(replay_frames):
                    break
                landmarks_xyzw = replay_frames[replay_idx]
                ts_ms = int(replay_idx * (1000.0 / replay_fps))
                current_ts_sec = replay_idx / replay_fps  # Use simulated time for replay
                replay_idx += 1
                frame = np.zeros((720, 960, 3), dtype=np.uint8)
            else:
                assert cap is not None and landmarker is not None
                ts_ms = int(time.time() * 1000)
                ret, raw = cap.read()
                if not ret:
                    break
                rgb = cv2.cvtColor(raw, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = landmarker.detect_for_video(mp_image, ts_ms)
                frame = cv2.flip(raw, 1) if args.mirror else raw
                if result.pose_landmarks and len(result.pose_landmarks) > 0:
                    landmarks_xyzw = mediapipe_landmarks_to_np(result.pose_landmarks[0])

            if landmarks_xyzw is None:
                if not args.no_window and frame is not None:
                    cv2.putText(frame, "No pose detected", (30, 40),
                                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2)
                    cv2.imshow("PT Coach v2", frame)
                    if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                        break
                frame_count += 1
                if args.max_frames > 0 and frame_count >= args.max_frames:
                    break
                continue

            payload = engine.infer(landmarks_xyzw, timestamp_sec=current_ts_sec)
            json_out.write_text(json.dumps(payload, indent=2), encoding="utf-8")

            if args.print_every > 0 and frame_count % args.print_every == 0:
                rms = payload["quality"]["rms_divergence"]
                n_coach = len(payload["coaching"])
                top_msg = payload["coaching"][0]["text"] if payload["coaching"] else "Looking good"
                print(f"frame={frame_count:04d} ref={payload['exercise']['reference_frame']:3d} "
                      f"rms={rms:.3f} coaching={n_coach} msg={top_msg}")

            if not args.no_window and frame is not None:
                # 1. Draw user skeleton (green)
                draw_user_skeleton(frame, landmarks_xyzw, mirror=args.mirror)
                # 2. Draw reference skeleton (orange ghost)
                draw_reference_skeleton(frame, payload["ref_skeleton_img"],
                                        engine.ref_norm[payload["exercise"]["reference_frame"]],
                                        mirror=args.mirror)
                # 3. Draw divergence lines (colored by severity)
                draw_divergence_lines(frame, payload["divergences"],
                                      engine.coach_threshold, mirror=args.mirror)
                # 4. Side panel
                composed = render_info_panel(frame, payload, engine.coach_threshold)
                cv2.imshow("PT Coach v2", composed)

                # 5. RMS over time graph (separate window)
                if len(engine.rms_history) >= 2:
                    rms_graph = render_rms_graph(engine.rms_history, engine.coach_threshold)
                    cv2.imshow("RMS Over Time - Improvement Tracker", rms_graph)

                if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                    break

            frame_count += 1
            if args.max_frames > 0 and frame_count >= args.max_frames:
                break

    finally:
        if cap is not None:
            cap.release()
        if landmarker is not None:
            landmarker.close()
        if not args.no_window:
            cv2.destroyAllWindows()

    elapsed = max(1e-6, time.time() - start_ts)
    print(f"Done. Frames={frame_count}, elapsed={elapsed:.1f}s, fps={frame_count/elapsed:.1f}")


if __name__ == "__main__":
    main()
