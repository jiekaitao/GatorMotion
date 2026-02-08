#!/usr/bin/env python3
"""Test PT coach engine against the demo video (requires MediaPipe + OpenCV).

This test processes the sample exercise video through MediaPipe pose detection
and feeds the landmarks into the PT coach engine, validating alignment and
correction behavior on real video input.

Skipped if the video file or pose model is not available.
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pt_coach.common import landmarks_list_to_np, load_reference_json
from live_coach import PTCoachEngine, open_pose_landmarker

PROJECT = Path(__file__).resolve().parent.parent
REPO_ROOT = PROJECT.parent
MODEL_NPZ = PROJECT / "models" / "squat_reference_model.npz"
META_JSON = PROJECT / "models" / "squat_reference_model.meta.json"
POSE_MODEL = PROJECT / "models" / "pose_landmarker_heavy.task"
VIDEO_PATH = REPO_ROOT / "web" / "public" / "sample-exercise.mp4"


def _extract_landmarks_from_video(video_path: Path, pose_model_path: Path, max_frames: int = 200):
    """Process a video through MediaPipe and return list of (ts_ms, landmarks_xyzw)."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import (
        PoseLandmarker,
        PoseLandmarkerOptions,
        RunningMode,
    )

    landmarker = PoseLandmarker.create_from_options(
        PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(pose_model_path)),
            running_mode=RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    )

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    results = []
    frame_idx = 0

    try:
        while frame_idx < max_frames:
            ret, raw = cap.read()
            if not ret:
                break
            ts_ms = int(frame_idx * (1000.0 / fps))
            rgb = cv2.cvtColor(raw, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect_for_video(mp_image, ts_ms)

            if result.pose_landmarks and len(result.pose_landmarks) > 0:
                from pt_coach.common import mediapipe_landmarks_to_np
                lms = mediapipe_landmarks_to_np(result.pose_landmarks[0])
                results.append((ts_ms, lms))

            frame_idx += 1
    finally:
        cap.release()
        landmarker.close()

    return results


@pytest.fixture(scope="module")
def video_landmarks():
    """Cache extracted landmarks for all tests in this module."""
    if not VIDEO_PATH.exists():
        pytest.skip(f"Demo video not found: {VIDEO_PATH}")
    if not POSE_MODEL.exists():
        pytest.skip(f"Pose model not found: {POSE_MODEL}")

    landmarks = _extract_landmarks_from_video(VIDEO_PATH, POSE_MODEL, max_frames=200)
    if len(landmarks) < 30:
        pytest.skip(f"Too few poses detected in video: {len(landmarks)}")
    return landmarks


class TestVideoAlignment:
    def test_video_produces_valid_output(self, video_landmarks):
        """Engine should produce well-formed output on real video (any exercise).

        Note: The demo video may not match the squat reference model, so we only
        check that the output is structurally valid, not that quality is high.
        """
        engine = PTCoachEngine(MODEL_NPZ, META_JSON)
        qualities = []
        distances = []
        for ts_ms, lms in video_landmarks:
            payload = engine.infer(lms, ts_ms)
            qualities.append(payload["quality"]["score"])
            distances.append(payload["quality"]["distance"])
            # Verify output structure
            assert "exercise" in payload
            assert "quality" in payload
            assert "corrections" in payload
            assert 0.0 <= payload["quality"]["score"] <= 1.0

        q = np.array(qualities[10:])
        d = np.array(distances[10:])
        print(f"Video quality: mean={q.mean():.3f}, distance: mean={d.mean():.2f}")
        # Just verify the engine runs without errors and produces bounded output
        assert len(qualities) == len(video_landmarks)

    def test_video_phase_progresses(self, video_landmarks):
        """Reference frame index should progress over time (not stuck at one value)."""
        engine = PTCoachEngine(MODEL_NPZ, META_JSON)
        ref_indices = []
        for ts_ms, lms in video_landmarks:
            payload = engine.infer(lms, ts_ms)
            ref_indices.append(payload["exercise"]["reference_frame"])

        unique_refs = len(set(ref_indices[10:]))
        print(f"Unique reference frames visited: {unique_refs}")
        assert unique_refs > 5, f"Phase not progressing: only {unique_refs} unique reference frames"

    def test_video_corrections_are_structured(self, video_landmarks):
        """All corrections should have required fields and valid values."""
        engine = PTCoachEngine(MODEL_NPZ, META_JSON)
        correction_count = 0
        for ts_ms, lms in video_landmarks:
            payload = engine.infer(lms, ts_ms)
            for corr in payload.get("corrections", []):
                correction_count += 1
                assert "id" in corr
                assert "severity" in corr
                assert corr["severity"] in ("low", "medium", "high")
                if "error_ratio" in corr:
                    assert corr["error_ratio"] > 0

        print(f"Total corrections validated: {correction_count}")

    def test_video_at_different_intervals(self, video_landmarks):
        """Process every Nth frame to simulate different playback speeds.
        Phase tracking should still be coherent.
        """
        for skip in [1, 2, 4]:
            engine = PTCoachEngine(MODEL_NPZ, META_JSON)
            sampled = video_landmarks[::skip]
            ref_indices = []
            for ts_ms, lms in sampled:
                payload = engine.infer(lms, ts_ms)
                ref_indices.append(payload["exercise"]["reference_frame"])

            # Check phase doesn't flicker wildly
            if len(ref_indices) > 5:
                diffs = np.diff(ref_indices[5:])
                # Large backward jumps (>10 frames) indicate instability
                large_jumps = int(np.sum(np.abs(diffs) > 15))
                print(f"skip={skip}: {len(sampled)} frames, large_jumps={large_jumps}")
                assert large_jumps < len(sampled) * 0.15, (
                    f"Too many large phase jumps at skip={skip}: {large_jumps}"
                )


    def test_video_correction_arrows_dont_flicker(self, video_landmarks):
        """Active corrections should not rapidly appear/disappear frame-to-frame."""
        engine = PTCoachEngine(MODEL_NPZ, META_JSON)
        prev_ids: set[str] = set()
        flicker_count = 0
        total_transitions = 0

        for ts_ms, lms in video_landmarks:
            payload = engine.infer(lms, ts_ms)
            cur_ids = {c["id"] for c in payload.get("corrections", [])
                       if c.get("ui")}  # only corrections with visual arrows
            # A "flicker" is when a correction appears and disappears within 1 frame
            appeared = cur_ids - prev_ids
            disappeared = prev_ids - cur_ids
            total_transitions += len(appeared) + len(disappeared)
            # If something appeared last frame and disappeared this frame = flicker
            if appeared and disappeared:
                flicker_count += 1
            prev_ids = cur_ids

        print(f"Flicker events: {flicker_count}, total transitions: {total_transitions}")
        # Flickering on > 20% of frames would indicate instability
        max_flicker = len(video_landmarks) * 0.20
        assert flicker_count < max_flicker, (
            f"Too many correction flicker events: {flicker_count} (max={max_flicker:.0f})"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
