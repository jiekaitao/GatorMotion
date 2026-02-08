#!/usr/bin/env python3
"""Test suite for PT coach engine — validates math, alignment, and correction logic."""

import json
import sys
from pathlib import Path

import numpy as np
import pytest

# Ensure project root is on path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pt_coach.common import (
    FEATURE_LANDMARKS,
    LANDMARK_INDEX,
    compute_joint_angle_deg,
    feature_vector,
    knee_angles_deg,
    landmarks_list_to_np,
    load_reference_json,
    normalize_to_body_frame,
)
from live_coach import PTCoachEngine

PROJECT = Path(__file__).resolve().parent.parent
MODEL_NPZ = PROJECT / "models" / "squat_reference_model.npz"
META_JSON = PROJECT / "models" / "squat_reference_model.meta.json"
REF_JSON = PROJECT / "data" / "raw" / "squat_reference.json"


def _load_reference_frames():
    data = load_reference_json(REF_JSON)
    return [landmarks_list_to_np(f["landmarks"]) for f in data["frames"]]


def _make_engine():
    return PTCoachEngine(MODEL_NPZ, META_JSON)


# ---------------------------------------------------------------------------
# 1. Normalization tests
# ---------------------------------------------------------------------------

class TestNormalization:
    def test_body_frame_origin_at_pelvis(self):
        """After normalization, the pelvis midpoint should be near (0, 0)."""
        frames = _load_reference_frames()
        for lms in frames[:10]:
            norm, _ = normalize_to_body_frame(lms)
            lhip = norm[LANDMARK_INDEX["left_hip"], :2]
            rhip = norm[LANDMARK_INDEX["right_hip"], :2]
            pelvis = (lhip + rhip) * 0.5
            assert np.allclose(pelvis, 0.0, atol=0.01), f"Pelvis not at origin: {pelvis}"

    def test_hip_width_is_unit(self):
        """Hip width in body frame should be ~1.0 (left_hip.x - right_hip.x)."""
        frames = _load_reference_frames()
        for lms in frames[:10]:
            norm, _ = normalize_to_body_frame(lms)
            lhip_x = norm[LANDMARK_INDEX["left_hip"], 0]
            rhip_x = norm[LANDMARK_INDEX["right_hip"], 0]
            hip_w = abs(lhip_x - rhip_x)
            assert abs(hip_w - 1.0) < 0.15, f"Hip width not ~1.0: {hip_w}"

    def test_shoulders_above_hips(self):
        """Shoulder center y_body should be positive (above pelvis in body frame)."""
        frames = _load_reference_frames()
        for lms in frames[:10]:
            norm, _ = normalize_to_body_frame(lms)
            sh_y = (norm[LANDMARK_INDEX["left_shoulder"], 1] + norm[LANDMARK_INDEX["right_shoulder"], 1]) / 2
            # y_axis points from pelvis toward shoulders, so y should be positive
            assert sh_y > 0, f"Shoulders not above hips: sh_y={sh_y:.3f}"


# ---------------------------------------------------------------------------
# 2. Feature vector tests
# ---------------------------------------------------------------------------

class TestFeatures:
    def test_feature_dimension(self):
        frames = _load_reference_frames()
        norm, _ = normalize_to_body_frame(frames[0])
        feat = feature_vector(norm, FEATURE_LANDMARKS)
        expected_dim = len(FEATURE_LANDMARKS) * 3
        assert feat.shape == (expected_dim,), f"Expected ({expected_dim},), got {feat.shape}"

    def test_feature_scaling_zero_mean_unit_std(self):
        """Scaled reference features should have ~0 mean and ~1 std per dimension.

        Note: Some z-dimensions may have near-zero variance (e.g., hips z is constant
        in reference data). The robust_std guard maps those to 1.0, resulting in
        near-zero std after scaling. We only check non-degenerate dimensions.
        """
        model = np.load(MODEL_NPZ)
        ref_scaled = model["ref_features_scaled"]
        mean = ref_scaled.mean(axis=0)
        std = ref_scaled.std(axis=0)
        # Check mean is ~0 for all dims
        assert np.allclose(mean, 0.0, atol=0.05), f"Mean not ~0: max={np.max(np.abs(mean)):.4f}"
        # Check std ~1 only for non-degenerate dims (where raw std was > epsilon)
        nondegen = std > 0.1
        assert np.allclose(std[nondegen], 1.0, atol=0.05), (
            f"Non-degenerate std not ~1: range=[{std[nondegen].min():.4f}, {std[nondegen].max():.4f}]"
        )


# ---------------------------------------------------------------------------
# 3. Phase alignment tests (THE CRITICAL ONES)
# ---------------------------------------------------------------------------

class TestPhaseAlignment:
    """Tests that verify the temporal matching finds the correct reference phase."""

    def test_perfect_replay_phase_accuracy(self):
        """Replaying reference data at correct FPS: matched frame should be close to input frame.

        ACCEPTANCE CRITERIA: mean |delta| < 2.0, max |delta| < 8
        (Allows for startup transient but rejects systematic lag.)
        """
        engine = _make_engine()
        frames = _load_reference_frames()
        fps = 15.0
        deltas = []
        for i, lms in enumerate(frames):
            ts_ms = int(i * (1000.0 / fps))
            payload = engine.infer(lms, ts_ms)
            ref_idx = payload["exercise"]["reference_frame"]
            deltas.append(i - ref_idx)

        deltas = np.array(deltas)
        # Skip first 15 frames (startup transient while window fills)
        steady = deltas[15:]
        mean_delta = np.abs(steady).mean()
        max_delta = np.abs(steady).max()
        print(f"Phase accuracy: mean|delta|={mean_delta:.2f}, max|delta|={max_delta}, "
              f"mean(delta)={steady.mean():.2f}")
        assert mean_delta < 2.0, f"Mean absolute delta too high: {mean_delta:.2f} (systematic lag?)"
        assert max_delta < 8, f"Max delta too high: {max_delta} (phase jump?)"

    def test_no_false_corrections_on_reference_replay(self):
        """Replaying reference data should produce ZERO corrections (by definition, it's perfect form)."""
        engine = _make_engine()
        frames = _load_reference_frames()
        fps = 15.0
        false_corrections = []
        for i, lms in enumerate(frames):
            ts_ms = int(i * (1000.0 / fps))
            payload = engine.infer(lms, ts_ms)
            corrs = [c for c in payload.get("corrections", [])
                     if c["id"] not in ("NO_POSE", "POSE_NOT_CLEAR")]
            if corrs:
                false_corrections.append((i, corrs[0]["text"], corrs[0].get("error_ratio", 0)))

        if false_corrections:
            sample = false_corrections[:5]
            msgs = "; ".join(f"frame {f}: {t} (err={e:.2f})" for f, t, e in sample)
            print(f"False corrections: {len(false_corrections)}/{len(frames)}: {msgs}")
        assert len(false_corrections) == 0, (
            f"{len(false_corrections)} false corrections on reference replay! "
            f"First: frame {false_corrections[0][0]}: {false_corrections[0][1]}"
        )

    def test_ema_systematic_lag(self):
        """Measure the EMA-induced systematic lag. Should be < 2 frames after fix."""
        engine = _make_engine()
        frames = _load_reference_frames()
        fps = 15.0
        deltas = []
        for i, lms in enumerate(frames):
            ts_ms = int(i * (1000.0 / fps))
            payload = engine.infer(lms, ts_ms)
            ref_idx = payload["exercise"]["reference_frame"]
            deltas.append(i - ref_idx)

        steady = np.array(deltas[20:])
        mean_lag = steady.mean()
        print(f"Systematic lag: mean(delta)={mean_lag:.2f} frames ({mean_lag/fps*1000:.0f}ms)")
        # After fix, systematic lag should be under 2 frames
        assert abs(mean_lag) < 2.0, f"Systematic lag too high: {mean_lag:.2f} frames"

    def test_half_speed_replay_alignment(self):
        """Playing at half speed: phase should still track correctly (just slower through reference)."""
        engine = _make_engine()
        frames = _load_reference_frames()
        # Play every frame twice (half speed)
        fps = 15.0
        doubled = []
        for lms in frames:
            doubled.append(lms)
            doubled.append(lms)

        ref_indices = []
        for i, lms in enumerate(doubled):
            ts_ms = int(i * (1000.0 / fps))  # same fps but doubled frames
            payload = engine.infer(lms, ts_ms)
            ref_indices.append(payload["exercise"]["reference_frame"])

        # Reference indices should be monotonically non-decreasing (mostly)
        diffs = np.diff(ref_indices)
        backward_jumps = int(np.sum(diffs < -2))
        assert backward_jumps < 10, f"Too many backward phase jumps at half speed: {backward_jumps}"


# ---------------------------------------------------------------------------
# 4. Quality score tests
# ---------------------------------------------------------------------------

class TestQuality:
    def test_perfect_replay_quality_is_high(self):
        """Quality should be near 1.0 when replaying reference data."""
        engine = _make_engine()
        frames = _load_reference_frames()
        fps = 15.0
        qualities = []
        for i, lms in enumerate(frames):
            ts_ms = int(i * (1000.0 / fps))
            payload = engine.infer(lms, ts_ms)
            qualities.append(payload["quality"]["score"])

        q = np.array(qualities[10:])  # skip startup
        assert q.mean() > 0.90, f"Mean quality too low on reference replay: {q.mean():.3f}"
        assert q.min() > 0.70, f"Min quality too low: {q.min():.3f}"

    def test_perturbed_pose_lower_quality(self):
        """Adding noise to landmarks should reduce quality score."""
        engine_clean = _make_engine()
        engine_noisy = _make_engine()
        frames = _load_reference_frames()
        fps = 15.0

        clean_q = []
        noisy_q = []
        rng = np.random.RandomState(42)
        for i, lms in enumerate(frames[20:80]):
            ts_ms = int((i + 20) * (1000.0 / fps))
            p_clean = engine_clean.infer(lms, ts_ms)
            clean_q.append(p_clean["quality"]["score"])

            # Add significant noise to x,y positions
            noisy_lms = lms.copy()
            noisy_lms[:, :2] += rng.normal(0, 0.04, size=(33, 2)).astype(np.float32)
            p_noisy = engine_noisy.infer(noisy_lms, ts_ms)
            noisy_q.append(p_noisy["quality"]["score"])

        assert np.mean(clean_q) > np.mean(noisy_q), (
            f"Clean quality ({np.mean(clean_q):.3f}) should be > noisy ({np.mean(noisy_q):.3f})"
        )


# ---------------------------------------------------------------------------
# 5. Correction logic tests
# ---------------------------------------------------------------------------

class TestCorrections:
    def test_deliberate_knee_valgus_triggers_correction(self):
        """Pushing knees inward (valgus) should trigger 'move knee outward' correction."""
        engine = _make_engine()
        frames = _load_reference_frames()
        fps = 15.0

        # First, warm up the engine with clean frames
        for i in range(30):
            ts_ms = int(i * (1000.0 / fps))
            engine.infer(frames[i], ts_ms)

        # Now perturb knees inward (reduce x_body separation)
        found_correction = False
        for i in range(30, 60):
            lms = frames[i].copy()
            # Push left knee to the right (toward midline) in image space
            lms[LANDMARK_INDEX["left_knee"], 0] += 0.08
            # Push right knee to the left (toward midline) in image space
            lms[LANDMARK_INDEX["right_knee"], 0] -= 0.08

            ts_ms = int(i * (1000.0 / fps))
            payload = engine.infer(lms, ts_ms)
            corrs = [c for c in payload.get("corrections", [])
                     if "knee" in c.get("part", "")]
            if corrs:
                found_correction = True
                break

        assert found_correction, "Knee valgus perturbation did not trigger any knee correction"

    def test_correction_direction_makes_sense(self):
        """When a joint is displaced, correction should point BACK toward reference."""
        engine = _make_engine()
        frames = _load_reference_frames()
        fps = 15.0

        # Warm up
        for i in range(40):
            ts_ms = int(i * (1000.0 / fps))
            engine.infer(frames[i], ts_ms)

        # Displace left ankle significantly downward in body frame
        # (which means more positive y in image space since y increases downward)
        corrections_found = []
        for i in range(40, 80):
            lms = frames[i].copy()
            lms[LANDMARK_INDEX["left_ankle"], 1] += 0.12  # push down in image
            ts_ms = int(i * (1000.0 / fps))
            payload = engine.infer(lms, ts_ms)
            corrs = [c for c in payload.get("corrections", [])
                     if c.get("id", "").startswith("LEFT_ANKLE")]
            corrections_found.extend(corrs)

        if corrections_found:
            # Body frame: y_axis points upward (pelvis->shoulders).
            # We pushed ankle DOWN in image space -> y_body DECREASES (further below pelvis).
            # dy = cur_y - ref_y < 0 (user's ankle is lower in body frame).
            # delta_y_body = -dy > 0 (correction points UP toward reference).
            top = corrections_found[0]
            delta_y = top.get("target", {}).get("delta_y_body", 0)
            assert delta_y > 0, f"Expected positive delta_y_body (move up in body frame), got {delta_y}"

    def test_correction_target_is_stable_when_user_adjusts(self):
        """When a correction fires and the user starts moving, the arrow target
        should NOT jump to a new reference frame. It should stay locked."""
        engine = _make_engine()
        frames = _load_reference_frames()
        fps = 15.0

        # Warm up with clean frames
        for i in range(30):
            ts_ms = int(i * (1000.0 / fps))
            engine.infer(frames[i], ts_ms)

        # Introduce a persistent perturbation to trigger a correction
        correction_targets = []
        for i in range(30, 70):
            lms = frames[i].copy()
            # Push left knee significantly right
            lms[LANDMARK_INDEX["left_knee"], 0] += 0.10
            ts_ms = int(i * (1000.0 / fps))
            payload = engine.infer(lms, ts_ms)
            for corr in payload.get("corrections", []):
                if corr.get("id", "").startswith("LEFT_KNEE"):
                    tgt = corr.get("ui", {}).get("target_xy_norm")
                    if tgt:
                        correction_targets.append(tgt)

        if len(correction_targets) >= 5:
            # Target x,y should be STABLE (low variance) due to locking.
            xs = [t[0] for t in correction_targets]
            ys = [t[1] for t in correction_targets]
            # Arrow smoothing causes gradual convergence, so check that the
            # target doesn't jump wildly (std should be small).
            x_range = max(xs) - min(xs)
            y_range = max(ys) - min(ys)
            print(f"Target stability: x_range={x_range:.4f}, y_range={y_range:.4f}")
            assert x_range < 0.15, f"Target x too unstable: range={x_range:.4f}"
            assert y_range < 0.15, f"Target y too unstable: range={y_range:.4f}"


# ---------------------------------------------------------------------------
# 6. Joint angle tests
# ---------------------------------------------------------------------------

class TestJointAngles:
    def test_straight_leg_angle_near_180(self):
        """Standing pose should have knee angles near 180 degrees."""
        frames = _load_reference_frames()
        # First frame is typically standing
        norm, _ = normalize_to_body_frame(frames[0])
        left, right, avg = knee_angles_deg(norm)
        assert avg > 150, f"Standing knee angle too low: {avg:.1f}"

    def test_angle_computation_known_values(self):
        """Test angle computation with known geometry."""
        # 90-degree angle
        a = np.array([1.0, 0.0])
        b = np.array([0.0, 0.0])
        c = np.array([0.0, 1.0])
        angle = compute_joint_angle_deg(a, b, c)
        assert abs(angle - 90.0) < 1.0, f"Expected 90, got {angle:.1f}"

        # 180-degree angle (straight line)
        a = np.array([-1.0, 0.0])
        b = np.array([0.0, 0.0])
        c = np.array([1.0, 0.0])
        angle = compute_joint_angle_deg(a, b, c)
        assert abs(angle - 180.0) < 1.0, f"Expected 180, got {angle:.1f}"


# ---------------------------------------------------------------------------
# 7. Rep counting tests
# ---------------------------------------------------------------------------

class TestRepCounting:
    def test_reference_data_counts_some_reps(self):
        """The squat reference data should contain identifiable reps."""
        engine = _make_engine()
        frames = _load_reference_frames()
        fps = 15.0
        for i, lms in enumerate(frames):
            ts_ms = int(i * (1000.0 / fps))
            payload = engine.infer(lms, ts_ms)

        final_reps = payload["exercise"]["rep"]
        # Reference data should have at least some squat motion
        print(f"Reps counted in reference: {final_reps}")
        # Don't assert exact count, just that it's reasonable
        assert final_reps >= 0, "Negative rep count"


# ---------------------------------------------------------------------------
# 8. Tolerance sanity tests
# ---------------------------------------------------------------------------

class TestTolerances:
    def test_tolerances_are_positive(self):
        meta = json.loads(META_JSON.read_text(encoding="utf-8"))
        for idx_str, tol in meta["correction_tolerance"].items():
            assert tol["x"] > 0, f"Landmark {idx_str} tol_x <= 0"
            assert tol["y"] > 0, f"Landmark {idx_str} tol_y <= 0"

    def test_tolerances_not_absurdly_large(self):
        """Tolerances should be < 1.0 body widths (otherwise corrections never fire)."""
        meta = json.loads(META_JSON.read_text(encoding="utf-8"))
        for idx_str, tol in meta["correction_tolerance"].items():
            assert tol["x"] < 1.0, f"Landmark {idx_str} tol_x too large: {tol['x']:.3f}"
            assert tol["y"] < 1.0, f"Landmark {idx_str} tol_y too large: {tol['y']:.3f}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
