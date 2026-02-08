#!/usr/bin/env python3
"""Live PT coach demo: webcam pose inference + data-driven corrective feedback."""

from __future__ import annotations

import argparse
import json
import textwrap
import time
from collections import deque
from pathlib import Path
from typing import Any

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode

from pt_coach.common import (
    LANDMARK_INDEX,
    feature_vector,
    knee_angles_deg,
    landmarks_list_to_np,
    load_reference_json,
    mediapipe_landmarks_to_np,
    moving_average,
    normalize_to_body_frame,
)


class PTCoachEngine:
    def __init__(self, model_npz: Path, metadata_json: Path):
        model = np.load(model_npz)
        self.ref_norm = model["ref_norm"]  # (N,33,3)
        self.ref_features_scaled = model["ref_features_scaled"]  # (N,D)
        self.feat_mean = model["feat_mean"]
        self.feat_std = model["feat_std"]

        meta = json.loads(metadata_json.read_text(encoding="utf-8"))
        self.meta = meta
        self.feature_landmarks = [int(i) for i in meta["feature_landmarks"]]
        self.correction_landmarks = [int(i) for i in meta["correction_landmarks"]]
        self.tol = {int(k): v for k, v in meta["correction_tolerance"].items()}
        self.dist_cal = meta["distance_calibration"]

        self.rep_count = 0
        self.rep_state = "standing"
        self.knee_hist: deque[float] = deque(maxlen=10)
        self.quality_hist: deque[float] = deque(maxlen=15)
        self.last_spoken_message = ""
        self.last_message_ts_ms = 0
        self.active_corrections: dict[str, bool] = {}
        self.overlay_state: dict[str, dict[str, np.ndarray]] = {}

        # Stricter anti-pedantic hysteresis:
        # only very high deviations trigger; clear once mostly corrected.
        self.activate_ratio = 2.5
        self.clear_ratio = 1.35
        self.activate_abs_dx = 0.06
        self.activate_abs_dy = 0.06
        self.clear_abs_dx = 0.022
        self.clear_abs_dy = 0.03

        # Arrow endpoint smoothing (larger alpha => smoother, slower).
        self.overlay_alpha_cur = 0.72
        self.overlay_alpha_tgt = 0.82

    def _scale_feature(self, feat: np.ndarray) -> np.ndarray:
        return (feat - self.feat_mean) / self.feat_std

    def _match_reference_index(self, feat_scaled: np.ndarray) -> tuple[int, float]:
        d = np.linalg.norm(self.ref_features_scaled - feat_scaled[None, :], axis=1)
        idx = int(np.argmin(d))
        return idx, float(d[idx])

    def _quality_from_distance(self, d: float) -> float:
        p50 = float(self.dist_cal["p50"])
        p99 = float(self.dist_cal["p99"])
        denom = max(1e-6, p99 - p50)
        quality = 1.0 - ((d - p50) / denom)
        return float(np.clip(quality, 0.0, 1.0))

    def _severity_from_ratio(self, r: float) -> str:
        if r >= 2.0:
            return "high"
        if r >= 1.35:
            return "medium"
        return "low"

    def _correction_message(self, side: str, part: str, direction: str, magnitude: str) -> str:
        phrase_mag = {
            "small": "slightly",
            "medium": "",
            "large": "more",
        }[magnitude]

        if phrase_mag:
            return f"Move your {side} {part} {direction} {phrase_mag}.".replace("  ", " ")
        return f"Move your {side} {part} {direction}."

    def _body_to_image_xy(self, frame_info: dict[str, np.ndarray], body_xy: np.ndarray) -> np.ndarray:
        pelvis = frame_info["pelvis"]
        x_axis = frame_info["x_axis"]
        y_axis = frame_info["y_axis"]
        scale = float(frame_info["scale"][0])
        return pelvis + (float(body_xy[0]) * scale) * x_axis + (float(body_xy[1]) * scale) * y_axis

    def _dominant_direction(self, dx: float, dy: float, ratio_x: float, ratio_y: float) -> str:
        directions = []
        if ratio_x >= 1.1:
            directions.append("right" if dx > 0 else "left")
        if ratio_y >= 1.1:
            directions.append("down" if dy > 0 else "up")

        if not directions:
            if abs(dx) >= abs(dy):
                return "right" if dx > 0 else "left"
            return "down" if dy > 0 else "up"

        return " and ".join(directions[:2])

    def _smooth_overlay_points(
        self, correction_id: str, cur_xy_img: np.ndarray, target_xy_img: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        prev = self.overlay_state.get(correction_id)
        cur = cur_xy_img.astype(np.float32)
        tgt = target_xy_img.astype(np.float32)
        if prev is None:
            self.overlay_state[correction_id] = {"cur": cur, "tgt": tgt}
            return cur, tgt

        cur_s = self.overlay_alpha_cur * prev["cur"] + (1.0 - self.overlay_alpha_cur) * cur
        tgt_s = self.overlay_alpha_tgt * prev["tgt"] + (1.0 - self.overlay_alpha_tgt) * tgt
        self.overlay_state[correction_id] = {"cur": cur_s, "tgt": tgt_s}
        return cur_s, tgt_s

    def _phase(self, ref_idx: int) -> str:
        t = ref_idx / max(1, self.ref_norm.shape[0] - 1)
        if t < 0.2:
            return "setup"
        if t < 0.45:
            return "descending"
        if t < 0.6:
            return "bottom"
        if t < 0.85:
            return "ascending"
        return "top"

    def _update_reps(self, knee_avg: float) -> None:
        self.knee_hist.append(knee_avg)
        k = moving_average(list(self.knee_hist), 5)
        if self.rep_state == "standing" and k < 125:
            self.rep_state = "down"
        elif self.rep_state == "down" and k > 160:
            self.rep_state = "standing"
            self.rep_count += 1

    def infer(self, landmarks_xyzw: np.ndarray, ts_ms: int) -> dict[str, Any]:
        norm, frame_info = normalize_to_body_frame(landmarks_xyzw)
        feat = feature_vector(norm, self.feature_landmarks)
        feat_scaled = self._scale_feature(feat)
        ref_idx, dist = self._match_reference_index(feat_scaled)

        quality = self._quality_from_distance(dist)
        self.quality_hist.append(quality)
        quality_smooth = moving_average(list(self.quality_hist), 8)

        left_knee, right_knee, knee_avg = knee_angles_deg(norm)
        self._update_reps(knee_avg)

        ref = self.ref_norm[ref_idx]
        corrections: list[dict[str, Any]] = []

        active_ids_now: set[str] = set()

        for idx in self.correction_landmarks:
            cur_x = float(norm[idx, 0])
            cur_y = float(norm[idx, 1])
            ref_x = float(ref[idx, 0])
            ref_y = float(ref[idx, 1])
            dx = cur_x - ref_x
            dy = cur_y - ref_y
            tol_x = float(self.tol[idx]["x"])
            tol_y = float(self.tol[idx]["y"])
            ratio_x = abs(dx) / max(tol_x, 1e-6)
            ratio_y = abs(dy) / max(tol_y, 1e-6)
            err_ratio = max(ratio_x, ratio_y)

            side = self.tol[idx]["side"]
            part = self.tol[idx]["part"]
            correction_id = f"{side.upper()}_{part.upper()}_{idx}"

            was_active = self.active_corrections.get(correction_id, False)
            should_activate = (
                err_ratio >= self.activate_ratio
                and (abs(dx) >= self.activate_abs_dx or abs(dy) >= self.activate_abs_dy)
            )
            should_clear = (
                err_ratio <= self.clear_ratio
                or (abs(dx) <= self.clear_abs_dx and abs(dy) <= self.clear_abs_dy)
            )
            is_active = (was_active and not should_clear) or (not was_active and should_activate)
            self.active_corrections[correction_id] = is_active

            if not is_active:
                continue
            active_ids_now.add(correction_id)

            direction = self._dominant_direction(dx, dy, ratio_x, ratio_y)

            mag = "small"
            if err_ratio >= 2.0:
                mag = "large"
            elif err_ratio >= 1.35:
                mag = "medium"

            target_xy_img = self._body_to_image_xy(frame_info, ref[idx, :2])
            cur_xy_img = landmarks_xyzw[idx, :2]
            cur_xy_img_s, target_xy_img_s = self._smooth_overlay_points(
                correction_id, cur_xy_img, target_xy_img
            )

            correction = {
                "id": correction_id,
                "severity": self._severity_from_ratio(err_ratio),
                "side": side,
                "part": part,
                "target": {
                    "delta_x_body": round(float(-dx), 4),
                    "delta_y_body": round(float(-dy), 4),
                    "units": "body_norm",
                },
                "why": {
                    "metric": "body_frame_position_error",
                    "current_x": round(cur_x, 4),
                    "target_x": round(ref_x, 4),
                    "delta_x": round(dx, 4),
                    "tol_x": round(tol_x, 4),
                    "current_y": round(cur_y, 4),
                    "target_y": round(ref_y, 4),
                    "delta_y": round(dy, 4),
                    "tol_y": round(tol_y, 4),
                    "ratio_x": round(ratio_x, 3),
                    "ratio_y": round(ratio_y, 3),
                    "ratio": round(float(err_ratio), 3),
                },
                "why_text": (
                    f"x {cur_x:+.2f}->{ref_x:+.2f} (tol {tol_x:.2f}), "
                    f"y {cur_y:+.2f}->{ref_y:+.2f} (tol {tol_y:.2f}), "
                    f"ratio {err_ratio:.2f}x"
                ),
                "ui": {
                    "landmark_index": int(idx),
                    "current_xy_norm": [round(float(cur_xy_img_s[0]), 4), round(float(cur_xy_img_s[1]), 4)],
                    "target_xy_norm": [round(float(target_xy_img_s[0]), 4), round(float(target_xy_img_s[1]), 4)],
                },
                "text": self._correction_message(side, part, direction, mag),
                "error_ratio": round(float(err_ratio), 3),
            }
            corrections.append(correction)

        # Drop stale smoothing tracks when a correction is inactive.
        stale_ids = [k for k in self.overlay_state if k not in active_ids_now]
        for sid in stale_ids:
            self.overlay_state.pop(sid, None)

        corrections.sort(key=lambda c: c["error_ratio"], reverse=True)

        visibility = float(np.mean(landmarks_xyzw[[11, 12, 23, 24, 25, 26, 27, 28], 3]))

        speech = {
            "should_speak": False,
            "text": "",
            "cooldown_ms": 5000,
        }

        if corrections:
            top = corrections[0]
            msg = top["text"]
            should_voice = top.get("severity") in {"medium", "high"}
            if should_voice and ((msg != self.last_spoken_message) or (ts_ms - self.last_message_ts_ms > 5000)):
                speech["should_speak"] = True
                speech["text"] = msg
                self.last_spoken_message = msg
                self.last_message_ts_ms = ts_ms

        payload = {
            "ts_ms": int(ts_ms),
            "exercise": {
                "name": self.meta.get("exercise_name", "squat"),
                "phase": self._phase(ref_idx),
                "rep": int(self.rep_count),
                "reference_frame": int(ref_idx),
            },
            "quality": {
                "score": round(float(quality_smooth), 3),
                "confidence": round(float(np.clip(visibility, 0.0, 1.0)), 3),
                "distance": round(float(dist), 4),
            },
            "measurements": {
                "left_knee_angle_deg": round(float(left_knee), 1),
                "right_knee_angle_deg": round(float(right_knee), 1),
                "avg_knee_angle_deg": round(float(knee_avg), 1),
                "left_foot_x_body": round(float(norm[LANDMARK_INDEX["left_foot_index"], 0]), 3),
                "right_foot_x_body": round(float(norm[LANDMARK_INDEX["right_foot_index"], 0]), 3),
            },
            "corrections": corrections,
            "speech": speech,
        }

        # Safety reminder only when tracking confidence is poor, not when form differs from reference.
        if visibility < 0.35 and not corrections:
            payload["corrections"].append(
                {
                    "id": "POSE_NOT_CLEAR",
                    "severity": "low",
                    "text": "Move fully into frame and face the camera.",
                }
            )

        return payload


class Replayer:
    def __init__(self, reference_json: Path):
        self.data = load_reference_json(reference_json)
        self.frames = self.data["frames"]
        self.i = 0

    def next_landmarks(self) -> np.ndarray | None:
        if not self.frames:
            return None
        frame = self.frames[self.i % len(self.frames)]
        self.i += 1
        return landmarks_list_to_np(frame["landmarks"])


def draw_pose_points(frame: np.ndarray, landmarks_xyzw: np.ndarray, color=(40, 255, 120)) -> None:
    h, w = frame.shape[:2]
    for i in range(33):
        x = int(np.clip(landmarks_xyzw[i, 0], 0.0, 1.0) * (w - 1))
        y = int(np.clip(landmarks_xyzw[i, 1], 0.0, 1.0) * (h - 1))
        vis = float(landmarks_xyzw[i, 3])
        if vis < 0.25:
            continue
        cv2.circle(frame, (x, y), 3, color, -1)


def draw_correction_overlays(frame: np.ndarray, payload: dict[str, Any]) -> None:
    h, w = frame.shape[:2]
    severity_color = {
        "low": (80, 190, 255),
        "medium": (0, 190, 255),
        "high": (40, 80, 255),
    }

    for corr in payload.get("corrections", []):
        ui = corr.get("ui", {})
        cur = ui.get("current_xy_norm")
        tgt = ui.get("target_xy_norm")
        if not cur or not tgt:
            continue

        p_cur = (
            int(np.clip(float(cur[0]), 0.0, 1.0) * (w - 1)),
            int(np.clip(float(cur[1]), 0.0, 1.0) * (h - 1)),
        )
        p_tgt = (
            int(np.clip(float(tgt[0]), 0.0, 1.0) * (w - 1)),
            int(np.clip(float(tgt[1]), 0.0, 1.0) * (h - 1)),
        )

        color = severity_color.get(corr.get("severity", "low"), (120, 220, 255))
        ratio = float(corr.get("error_ratio", 1.0))
        thickness = 2 if ratio < 1.8 else 3

        cv2.arrowedLine(frame, p_cur, p_tgt, color, thickness, cv2.LINE_AA, tipLength=0.24)
        cv2.circle(frame, p_cur, 6, color, 2)
        cv2.drawMarker(frame, p_tgt, (255, 255, 255), cv2.MARKER_CROSS, 10, 1, cv2.LINE_AA)

        label = f"{corr.get('side', '')} {corr.get('part', '')}".strip()
        if label:
            cv2.putText(
                frame,
                label,
                (p_cur[0] + 8, p_cur[1] - 8),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                color,
                1,
                cv2.LINE_AA,
            )


def render_panel(frame: np.ndarray, payload: dict[str, Any], width: int = 410) -> np.ndarray:
    h, w = frame.shape[:2]
    panel = np.zeros((h, width, 3), dtype=np.uint8)
    panel[:] = (18, 18, 22)

    y = 35
    line_h = 22

    def write_line(text: str, color=(240, 240, 240), scale=0.62, thickness=1):
        nonlocal y
        cv2.putText(panel, text, (14, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)
        y += line_h

    write_line("PT Coach Demo (Squat)", color=(120, 230, 255), scale=0.72, thickness=2)
    write_line(f"Rep: {payload['exercise']['rep']}    Phase: {payload['exercise']['phase']}")
    write_line(
        f"Quality: {payload['quality']['score']:.2f}    Conf: {payload['quality']['confidence']:.2f}",
        color=(180, 255, 180),
    )

    y += 8
    cv2.line(panel, (12, y), (width - 12, y), (70, 70, 75), 1)
    y += 28

    corr = payload.get("corrections", [])
    write_line("Live Coaching", color=(255, 210, 120), scale=0.68, thickness=2)
    if corr:
        hidden_count = 0
        for i, item in enumerate(corr):
            if y > h - 140:
                hidden_count = len(corr) - i
                break

            sev = item.get("severity", "low").upper()
            reason_color = (110, 215, 255) if i == 0 else (220, 220, 230)
            write_line(f"{i+1}. [{sev}] {item.get('text', '')}", color=reason_color, scale=0.54, thickness=1)

            why_text = item.get("why_text", "")
            if why_text:
                wrapped_why = textwrap.wrap(f"why: {why_text}", width=48)[:2]
                for why_line in wrapped_why:
                    if y > h - 130:
                        break
                    write_line(why_line, color=(175, 175, 185), scale=0.45, thickness=1)

            y += 2

        if hidden_count > 0:
            write_line(f"+{hidden_count} more shown in JSON", color=(150, 150, 160), scale=0.5)
    else:
        write_line("Looking good. Keep going.", color=(190, 255, 190), scale=0.66, thickness=2)

    y += 8
    cv2.line(panel, (12, y), (width - 12, y), (70, 70, 75), 1)
    y += 28

    m = payload.get("measurements", {})
    has_metrics = all(k in m for k in ("avg_knee_angle_deg", "left_foot_x_body", "right_foot_x_body"))
    if has_metrics:
        write_line(
            f"Avg knee angle: {float(m['avg_knee_angle_deg']):.1f} deg",
            color=(210, 220, 255),
            scale=0.60,
        )
        write_line(
            f"L/R foot x_body: {float(m['left_foot_x_body']):+.2f} / {float(m['right_foot_x_body']):+.2f}",
            color=(210, 220, 255),
            scale=0.56,
        )
    else:
        write_line("Measurements: waiting for pose...", color=(210, 220, 255), scale=0.58)

    # Compose side-by-side output.
    return np.concatenate([frame, panel], axis=1)


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


def open_camera_with_fallback(preferred_index: int) -> tuple[cv2.VideoCapture, int]:
    """Open a camera robustly on macOS and return (capture, selected_index)."""

    candidate_indices = []
    for idx in [preferred_index, 0, 1, 2]:
        if idx not in candidate_indices:
            candidate_indices.append(idx)

    for idx in candidate_indices:
        cap = cv2.VideoCapture(idx, cv2.CAP_AVFOUNDATION)
        if not cap.isOpened():
            cap.release()
            cap = cv2.VideoCapture(idx)
        if not cap.isOpened():
            cap.release()
            continue

        # Warm-up: some drivers need a few reads before first valid frame.
        ok = False
        for _ in range(20):
            ret, _ = cap.read()
            if ret:
                ok = True
                break
            time.sleep(0.03)

        if ok:
            return cap, idx

        cap.release()

    raise RuntimeError(
        "Cannot open any camera device (tried preferred index + 0/1/2). "
        "Check macOS Camera permission for your terminal app."
    )


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Live PT coach demo")
    parser.add_argument("--model", default="models/squat_reference_model.npz")
    parser.add_argument("--metadata", default="models/squat_reference_model.meta.json")
    parser.add_argument("--pose-model", default="models/pose_landmarker_heavy.task")
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--mirror", action="store_true", help="Mirror display preview")
    parser.add_argument("--json-out", default="outputs/live_state.json")
    parser.add_argument("--source-json", default="", help="Replay landmark JSON instead of webcam")
    parser.add_argument("--no-window", action="store_true", help="Disable OpenCV UI window")
    parser.add_argument("--max-frames", type=int, default=0, help="Stop after N frames (0=run forever)")
    parser.add_argument("--print-every", type=int, default=10, help="Console print cadence in frames")
    args = parser.parse_args()

    model_path = Path(args.model)
    metadata_path = Path(args.metadata)
    pose_model_path = Path(args.pose_model)
    json_out_path = Path(args.json_out)

    if not model_path.exists() or not metadata_path.exists():
        raise FileNotFoundError(
            "Model files not found. Run train_model.py first:\n"
            f"  missing: {model_path} or {metadata_path}"
        )

    ensure_parent(json_out_path)

    engine = PTCoachEngine(model_path, metadata_path)

    cap = None
    landmarker = None
    replayer = None

    if args.source_json:
        replayer = Replayer(Path(args.source_json))
        print(f"Replay mode from: {args.source_json}")
    else:
        if not pose_model_path.exists():
            raise FileNotFoundError(f"Pose model missing: {pose_model_path}")
        landmarker = open_pose_landmarker(pose_model_path)
        cap, selected_cam = open_camera_with_fallback(args.camera)
        print(f"Camera mode started (index={selected_cam})")

    start_ts = time.time()
    frame_count = 0

    try:
        while True:
            ts_ms = int(time.time() * 1000)
            frame = None
            landmarks_xyzw = None

            if replayer is not None:
                landmarks_xyzw = replayer.next_landmarks()
                if landmarks_xyzw is None:
                    break
                frame = np.zeros((720, 960, 3), dtype=np.uint8)
                draw_pose_points(frame, landmarks_xyzw)
            else:
                assert cap is not None and landmarker is not None
                ret, raw = cap.read()
                if not ret:
                    print("Camera read failed; stopping.")
                    break

                rgb = cv2.cvtColor(raw, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = landmarker.detect_for_video(mp_image, ts_ms)

                frame = raw
                if result.pose_landmarks and len(result.pose_landmarks) > 0:
                    landmarks_xyzw = mediapipe_landmarks_to_np(result.pose_landmarks[0])
                    draw_pose_points(frame, landmarks_xyzw)

            if landmarks_xyzw is None:
                payload = {
                    "ts_ms": ts_ms,
                    "exercise": {"name": "squat", "phase": "setup", "rep": 0},
                    "quality": {"score": 0.0, "confidence": 0.0},
                    "measurements": {
                        "left_knee_angle_deg": 0.0,
                        "right_knee_angle_deg": 0.0,
                        "avg_knee_angle_deg": 0.0,
                        "left_foot_x_body": 0.0,
                        "right_foot_x_body": 0.0,
                    },
                    "corrections": [
                        {
                            "id": "NO_POSE",
                            "severity": "low",
                            "text": "No pose detected. Step into frame.",
                        }
                    ],
                    "speech": {"should_speak": False, "cooldown_ms": 5000},
                }
            else:
                payload = engine.infer(landmarks_xyzw, ts_ms)

            json_out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

            if args.print_every > 0 and frame_count % args.print_every == 0:
                top_msg = payload["corrections"][0]["text"] if payload.get("corrections") else "Looking good"
                print(
                    f"frame={frame_count:04d} rep={payload['exercise']['rep']} "
                    f"quality={payload['quality']['score']:.2f} msg={top_msg}"
                )

            if not args.no_window:
                draw_correction_overlays(frame, payload)
                if args.mirror:
                    frame = cv2.flip(frame, 1)
                composed = render_panel(frame, payload)
                cv2.imshow("PT Coach Live Demo", composed)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), 27):
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
    fps = frame_count / elapsed
    print(f"Finished. Frames={frame_count}, elapsed={elapsed:.2f}s, approx_fps={fps:.1f}")
    print(f"Live JSON output: {json_out_path}")


if __name__ == "__main__":
    main()
