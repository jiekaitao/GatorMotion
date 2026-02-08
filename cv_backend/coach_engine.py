"""CoachV2Engine: divergence-based form coaching for production use.

Adapted from EXPERIMENT_PT_coach/live_coach_v2.py (CoachV2Engine class).
No cv2 visualization -- returns structured data for frontend rendering.
"""

from __future__ import annotations

import json
import math
from collections import deque
from pathlib import Path
from typing import Any

import numpy as np

from pt_coach.common import (
    ALIGNMENT_LANDMARKS,
    FEATURE_LANDMARKS,
    SIDE_BY_INDEX,
    PART_BY_INDEX,
    correction_landmarks_for_exercise,
    feature_vector,
    knee_angles_deg,
    moving_average,
    normalize_to_body_frame,
    procrustes_align_2d,
)


class CoachV2Engine:
    """Simple divergence-based coaching engine.

    Match frame -> measure divergence -> coach if above threshold.
    No cv2 or visualization code -- purely returns structured dicts.
    """

    def __init__(self, model_npz_path: str | Path):
        model_npz_path = Path(model_npz_path)
        metadata_json_path = model_npz_path.with_suffix("").with_suffix(".meta.json")

        model = np.load(model_npz_path)
        self.ref_norm = model["ref_norm"]              # (N, 33, 3)
        self.ref_features_scaled = model["ref_features_scaled"]  # (N, D)
        self.feat_mean = model["feat_mean"]
        self.feat_std = model["feat_std"]

        meta = json.loads(metadata_json_path.read_text(encoding="utf-8"))
        self.meta = meta
        self.feature_landmarks = [int(i) for i in meta["feature_landmarks"]]
        self.correction_landmarks = [int(i) for i in meta["correction_landmarks"]]
        self.dist_cal = meta["distance_calibration"]

        # Coaching threshold: divergence (in body-frame units) above which we coach.
        # 0.04 per joint is roughly ~1-2cm for an average person.
        self.coach_threshold = 0.04

        # Quality smoothing
        self.quality_hist: deque[float] = deque(maxlen=12)

        # RMS history for graphing improvement over time
        # Store (timestamp_sec, rms_divergence) tuples
        self.rms_history: deque[tuple[float, float]] = deque(maxlen=300)  # ~10 sec @ 30fps

        # Rep counting via knee angle state machine
        self.rep_count = 0
        self.rep_state = "standing"
        self.knee_hist: deque[float] = deque(maxlen=10)

        # Thresholds from meta calibration or defaults
        knee_cal = meta.get("knee_angle_calibration", {})
        self.standing_threshold = knee_cal.get("p90", 155.0)
        self.down_threshold = knee_cal.get("p10", 120.0)

    def _scale_feature(self, feat: np.ndarray) -> np.ndarray:
        """Normalize feature by saved mean/std."""
        return (feat - self.feat_mean) / self.feat_std

    def _match_frame(self, feat_scaled: np.ndarray) -> tuple[int, float]:
        """Nearest-neighbor match by euclidean distance in scaled feature space.

        Returns (ref_index, distance).
        """
        d = np.linalg.norm(self.ref_features_scaled - feat_scaled[None, :], axis=1)
        idx = int(np.argmin(d))
        return idx, float(d[idx])

    def _quality_from_distance(self, d: float) -> float:
        """Map distance to 0-1 using calibration p50/p90 values."""
        p50 = float(self.dist_cal["p50"])
        p99 = float(self.dist_cal["p99"])
        denom = max(1e-6, p99 - p50)
        quality = 1.0 - ((d - p50) / denom)
        return float(np.clip(quality, 0.0, 1.0))

    def _update_reps(self, knee_avg: float) -> None:
        """Knee angle state machine for rep counting.

        standing threshold ~155 deg, down threshold ~120 deg (from meta calibration).
        """
        self.knee_hist.append(knee_avg)
        k = moving_average(list(self.knee_hist), 5)
        if self.rep_state == "standing" and k < self.down_threshold:
            self.rep_state = "down"
        elif self.rep_state == "down" and k > self.standing_threshold:
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

    def infer(self, landmarks_xyzw: np.ndarray, timestamp_sec: float) -> dict:
        """Run inference on a single frame.

        Args:
            landmarks_xyzw: 33x4 array of landmarks (x, y, z, visibility)
            timestamp_sec: Timestamp in seconds for RMS history tracking

        Returns a dict with:
            rms_divergence (float),
            quality (float 0-1),
            divergences (list of dicts with side, part, delta_x, delta_y, distance),
            coaching_messages (list of dicts with type, text),
            rms_history (last 60 entries of {timeSec, rms})
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

        # --- Procrustes alignment: rotate+scale the reference to best match the user ---
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
            # Not enough visible landmarks -- fall back to raw body-frame comparison
            ref_aligned = ref[:, :2].copy()

        # Compute per-joint divergence using exercise-specific correction landmarks
        divergences: list[dict[str, Any]] = []
        coaching_messages: list[dict[str, Any]] = []
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

            side = SIDE_BY_INDEX.get(idx, "")
            part = PART_BY_INDEX.get(idx, "")

            div_entry = {
                "side": side,
                "part": part,
                "delta_x": round(float(delta[0]), 4),
                "delta_y": round(float(delta[1]), 4),
                "distance": round(div_dist, 4),
            }
            divergences.append(div_entry)

            # Coach only above threshold (0.04 per joint)
            if div_dist > self.coach_threshold:
                direction = self._direction_text(float(delta[0]), float(delta[1]))
                magnitude = "slightly" if div_dist < 0.20 else ("" if div_dist < 0.35 else "more")
                msg = f"Move your {side} {part} {direction}"
                if magnitude:
                    msg += f" {magnitude}"
                msg = msg.strip().replace("  ", " ") + "."

                coaching_messages.append({
                    "type": "correction",
                    "text": msg,
                })

        rms_div = math.sqrt(total_div_sq / max(1, n_visible))

        # Track RMS over time
        self.rms_history.append((float(timestamp_sec), float(rms_div)))

        # Sort coaching by divergence implicitly (we process in correction_landmarks order,
        # but the worst-first ordering is useful for the frontend)
        # Re-attach divergence info for sorting
        for i, cm in enumerate(coaching_messages):
            cm["_div"] = divergences[i]["distance"] if i < len(divergences) else 0
        coaching_messages.sort(key=lambda c: c.get("_div", 0), reverse=True)
        for cm in coaching_messages:
            cm.pop("_div", None)

        # Last 60 RMS history points for frontend sparkline
        rms_hist_list = [
            {"timeSec": round(t, 2), "rms": round(r, 4)}
            for t, r in list(self.rms_history)[-60:]
        ]

        return {
            "rms_divergence": round(float(rms_div), 4),
            "quality": round(float(quality_smooth), 3),
            "divergences": divergences,
            "coaching_messages": coaching_messages,
            "rms_history": rms_hist_list,
        }
