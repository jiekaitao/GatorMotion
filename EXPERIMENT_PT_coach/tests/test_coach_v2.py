#!/usr/bin/env python3
"""Tests for PT Coach v2 — divergence-based coaching."""

import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pt_coach.common import LANDMARK_INDEX, landmarks_list_to_np, load_reference_json
from live_coach_v2 import CoachV2Engine

PROJECT = Path(__file__).resolve().parent.parent
MODEL_NPZ = PROJECT / "models" / "squat_reference_model.npz"
META_JSON = PROJECT / "models" / "squat_reference_model.meta.json"
REF_JSON = PROJECT / "data" / "raw" / "squat_reference.json"


def _load_frames():
    data = load_reference_json(REF_JSON)
    return [landmarks_list_to_np(f["landmarks"]) for f in data["frames"]]


def _engine():
    return CoachV2Engine(MODEL_NPZ, META_JSON)


class TestV2Matching:
    def test_perfect_replay_zero_divergence(self):
        """Reference replay should have zero divergence everywhere."""
        engine = _engine()
        frames = _load_frames()
        for i, lms in enumerate(frames):
            payload = engine.infer(lms)
            assert payload["exercise"]["reference_frame"] == i, (
                f"Frame {i} matched to ref {payload['exercise']['reference_frame']}"
            )
            assert payload["quality"]["rms_divergence"] < 0.001

    def test_perfect_replay_no_coaching(self):
        engine = _engine()
        frames = _load_frames()
        for lms in frames:
            payload = engine.infer(lms)
            assert len(payload["coaching"]) == 0

    def test_perturbed_knee_triggers_coaching(self):
        """Pushing knee inward should produce coaching above threshold."""
        engine = _engine()
        frames = _load_frames()
        found = False
        for lms in frames[20:60]:
            perturbed = lms.copy()
            perturbed[LANDMARK_INDEX["left_knee"], 0] += 0.10
            payload = engine.infer(perturbed)
            knee_coaching = [c for c in payload["coaching"] if c["part"] == "knee"]
            if knee_coaching:
                found = True
                assert knee_coaching[0]["divergence"] > engine.coach_threshold
                break
        assert found, "Knee perturbation didn't trigger coaching"

    def test_divergence_increases_with_perturbation(self):
        """Larger perturbations should produce larger divergences."""
        engine = _engine()
        lms = _load_frames()[50]
        divs = []
        for offset in [0.0, 0.05, 0.10, 0.15]:
            perturbed = lms.copy()
            perturbed[LANDMARK_INDEX["left_knee"], 0] += offset
            payload = engine.infer(perturbed)
            divs.append(payload["quality"]["rms_divergence"])
        for i in range(1, len(divs)):
            assert divs[i] >= divs[i - 1], f"Divergence not monotonic: {divs}"

    def test_coaching_clears_when_corrected(self):
        """Coaching should disappear when perturbation is removed."""
        engine = _engine()
        frames = _load_frames()
        # Perturbed frames
        for lms in frames[20:40]:
            p = lms.copy()
            p[LANDMARK_INDEX["left_knee"], 0] += 0.12
            engine.infer(p)

        # Clean frames — coaching should clear
        payload = engine.infer(frames[40])
        assert len(payload["coaching"]) == 0, "Coaching didn't clear on clean frame"

    def test_divergence_lines_have_both_endpoints(self):
        """Each divergence entry should have user and ref image coordinates."""
        engine = _engine()
        lms = _load_frames()[30].copy()
        lms[LANDMARK_INDEX["left_ankle"], 0] += 0.08
        payload = engine.infer(lms)
        for div in payload["divergences"]:
            assert "user_img_xy" in div
            assert "ref_img_xy" in div
            assert len(div["user_img_xy"]) == 2
            assert len(div["ref_img_xy"]) == 2

    def test_ref_skeleton_has_33_points(self):
        engine = _engine()
        payload = engine.infer(_load_frames()[0])
        assert len(payload["ref_skeleton_img"]) == 33

    def test_threshold_controls_coaching_sensitivity(self):
        """Higher threshold = fewer coaching messages."""
        frames = _load_frames()
        lms = frames[30].copy()
        lms[LANDMARK_INDEX["left_knee"], 0] += 0.10

        tight = CoachV2Engine(MODEL_NPZ, META_JSON)
        tight.coach_threshold = 0.05
        p_tight = tight.infer(lms)

        loose = CoachV2Engine(MODEL_NPZ, META_JSON)
        loose.coach_threshold = 0.50
        p_loose = loose.infer(lms)

        assert len(p_tight["coaching"]) >= len(p_loose["coaching"])


class TestProcrustes:
    def test_rotation_invariance(self):
        """Rotating the user's entire pose should NOT increase divergence significantly.

        Without Procrustes, rotating 15 degrees would create large divergence.
        With Procrustes, the rotation is factored out first.
        """
        engine = _engine()
        frames = _load_frames()
        lms = frames[50].copy()

        # Baseline: unrotated
        payload_base = engine.infer(lms)
        rms_base = payload_base["quality"]["rms_divergence"]

        # Rotate all landmarks 15 degrees around the image center
        angle_rad = np.radians(15.0)
        cos_a, sin_a = np.cos(angle_rad), np.sin(angle_rad)
        cx, cy = 0.5, 0.5  # image center
        rotated = lms.copy()
        for i in range(33):
            dx = rotated[i, 0] - cx
            dy = rotated[i, 1] - cy
            rotated[i, 0] = cx + cos_a * dx - sin_a * dy
            rotated[i, 1] = cy + sin_a * dx + cos_a * dy

        payload_rot = engine.infer(rotated)
        rms_rot = payload_rot["quality"]["rms_divergence"]
        rot_deg = payload_rot["procrustes"]["rotation_deg"]

        print(f"Baseline RMS: {rms_base:.4f}, Rotated 15deg RMS: {rms_rot:.4f}, "
              f"Procrustes rotation: {rot_deg:.1f}deg")

        # RMS should stay low (Procrustes removes the rotation)
        # Allow some increase due to the nearest-neighbor matching a slightly different frame
        assert rms_rot < rms_base + 0.15, (
            f"Rotation increased RMS too much: {rms_base:.4f} -> {rms_rot:.4f}"
        )

    def test_procrustes_on_reference_gives_zero(self):
        """Procrustes aligning reference to itself should give zero divergence."""
        from pt_coach.common import procrustes_align_2d, ALIGNMENT_LANDMARKS, normalize_to_body_frame

        frames = _load_frames()
        lms = frames[30]
        norm, _ = normalize_to_body_frame(lms)

        user_pts = norm[ALIGNMENT_LANDMARKS, :2]
        ref_pts = norm[ALIGNMENT_LANDMARKS, :2].copy()
        aligned, rot, s, t = procrustes_align_2d(user_pts, ref_pts)

        residual = np.linalg.norm(aligned - user_pts)
        assert residual < 1e-6, f"Self-alignment residual too high: {residual}"
        assert abs(s - 1.0) < 1e-4, f"Scale should be 1.0, got {s}"

    def test_procrustes_removes_pure_rotation(self):
        """A pure rotation of the reference should be perfectly removed."""
        from pt_coach.common import procrustes_align_2d, ALIGNMENT_LANDMARKS, normalize_to_body_frame

        frames = _load_frames()
        norm, _ = normalize_to_body_frame(frames[30])
        pts = norm[ALIGNMENT_LANDMARKS, :2].copy()

        # Rotate by 20 degrees
        angle = np.radians(20.0)
        R = np.array([[np.cos(angle), -np.sin(angle)],
                       [np.sin(angle),  np.cos(angle)]], dtype=np.float32)
        rotated = (pts @ R.T)

        aligned, rot, s, t = procrustes_align_2d(pts, rotated)
        residual = np.linalg.norm(aligned - pts)
        print(f"Pure rotation residual: {residual:.6f}")
        assert residual < 0.01, f"Procrustes didn't remove rotation: residual={residual}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
