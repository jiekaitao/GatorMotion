"""
Extract skeleton keypoint data from exercise videos using MediaPipe Pose.

Processes the Zenodo exercise dataset organized as Ex1/...Ex6/ subfolders,
each containing multiple performer videos at two camera angles.

For each exercise, extracts skeletons from ALL performers and computes a
MEDIAN skeleton — averaging out individual differences to produce the best
possible reference animation.

Usage:
    # Process all exercises (Ex1-Ex6 subfolders with median averaging)
    python skeleton_extractor.py --input_dir "C:/Users/Fabio Jorge/Downloads/videos" --output_dir skeleton_data

    # Single video
    python skeleton_extractor.py --input video.mp4 --output skeleton_data/exercise.json

    # Options
    python skeleton_extractor.py --input_dir ./videos --output_dir ./skeleton_data --camera Camera18 --target_fps 15 --min_confidence 0.7
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    PoseLandmarker,
    PoseLandmarkerOptions,
    RunningMode,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
POSE_MODEL = os.path.join(SCRIPT_DIR, "models", "pose_landmarker_heavy.task")

# MediaPipe Pose 33-landmark names
LANDMARK_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer",
    "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_pinky", "right_pinky",
    "left_index", "right_index", "left_thumb", "right_thumb",
    "left_hip", "right_hip", "left_knee", "right_knee",
    "left_ankle", "right_ankle", "left_heel", "right_heel",
    "left_foot_index", "right_foot_index",
]

# Key body landmarks for confidence checks and normalization
KEY_BODY_INDICES = [11, 12, 23, 24, 25, 26, 27, 28]  # shoulders, hips, knees, ankles


def extract_skeleton(
    video_path: str,
    exercise_name: str = None,
    min_confidence: float = 0.5,
    target_fps: int = None,
    start_sec: float = None,
    end_sec: float = None,
) -> dict | None:
    """Extract skeleton data from a single video file.

    Returns dict with frame-by-frame landmarks, or None on failure.
    """
    if not os.path.isfile(video_path):
        print(f"  ERROR: File not found: {video_path}")
        return None

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  ERROR: Cannot open: {video_path}")
        return None

    source_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames_raw = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    out_fps = target_fps if target_fps else source_fps
    frame_skip = max(1, round(source_fps / out_fps)) if target_fps else 1

    print(f"  Processing: {os.path.basename(video_path)} ({width}x{height}, {total_frames_raw} frames)")

    landmarker = PoseLandmarker.create_from_options(
        PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=POSE_MODEL),
            running_mode=RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    )

    frames_data = []
    frame_idx = 0
    kept = 0
    skipped = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_skip != 0:
            frame_idx += 1
            continue

        current_sec = frame_idx / source_fps
        if start_sec is not None and current_sec < start_sec:
            frame_idx += 1
            continue
        if end_sec is not None and current_sec > end_sec:
            break

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        timestamp_ms = int((frame_idx / source_fps) * 1000)
        result = landmarker.detect_for_video(mp_image, timestamp_ms)

        if not result.pose_landmarks or len(result.pose_landmarks) == 0:
            skipped += 1
            frame_idx += 1
            continue

        landmarks = result.pose_landmarks[0]
        world_landmarks = result.pose_world_landmarks[0] if result.pose_world_landmarks else None

        vis_scores = [
            landmarks[i].visibility for i in KEY_BODY_INDICES
            if i < len(landmarks) and landmarks[i].visibility is not None
        ]
        avg_confidence = float(np.mean(vis_scores)) if vis_scores else 0

        if avg_confidence < min_confidence:
            skipped += 1
            frame_idx += 1
            continue

        frame_landmarks = []
        for k, lm in enumerate(landmarks):
            # Use world_landmarks Z for better depth accuracy
            z_val = float(world_landmarks[k].z) if world_landmarks and k < len(world_landmarks) else float(lm.z)
            frame_landmarks.append({
                "x": round(float(lm.x), 5),
                "y": round(float(lm.y), 5),
                "z": round(z_val, 5),
                "visibility": round(float(lm.visibility), 4) if lm.visibility else 0.0,
            })

        frames_data.append({
            "frame": kept,
            "timestamp": round(frame_idx / source_fps, 4),
            "landmarks": frame_landmarks,
            "avg_confidence": round(avg_confidence, 4),
        })
        kept += 1
        frame_idx += 1

    cap.release()
    landmarker.close()

    print(f"    -> {kept} frames extracted, {skipped} skipped")

    if kept == 0:
        return None

    # Smooth Z values to reduce monocular depth jitter
    smooth_z_values(frames_data, window=5)

    quality_score = float(np.mean([f["avg_confidence"] for f in frames_data]))

    return {
        "exercise": exercise_name or "",
        "source_file": os.path.basename(video_path),
        "fps": out_fps,
        "total_frames": kept,
        "duration_seconds": round(kept / out_fps, 2),
        "quality_score": round(quality_score, 4),
        "landmark_names": LANDMARK_NAMES,
        "frames": frames_data,
    }


def smooth_z_values(frames: list[dict], window: int = 5) -> list[dict]:
    """Apply moving-average smoothing to Z values to reduce frame-to-frame jitter.

    Args:
        frames: List of frame dicts with landmarks.
        window: Smoothing window size (odd number recommended).

    Returns: frames with smoothed Z values (modified in-place).
    """
    if len(frames) < window:
        return frames

    num_landmarks = len(frames[0]["landmarks"])
    half = window // 2

    # Extract all Z values: shape (num_frames, num_landmarks)
    z_arr = np.array([[lm["z"] for lm in f["landmarks"]] for f in frames])

    # Apply uniform moving average per landmark
    smoothed = np.copy(z_arr)
    for j in range(num_landmarks):
        kernel = np.ones(window) / window
        padded = np.pad(z_arr[:, j], half, mode="edge")
        smoothed[:, j] = np.convolve(padded, kernel, mode="valid")[:len(frames)]

    # Write back
    for i, frame in enumerate(frames):
        for j, lm in enumerate(frame["landmarks"]):
            lm["z"] = round(float(smoothed[i, j]), 5)

    return frames


def normalize_skeleton_frames(frames: list[dict]) -> np.ndarray:
    """Convert frames to a normalized numpy array.

    Centers skeleton on hip midpoint and scales to unit height
    (distance from hip midpoint to shoulder midpoint = 1.0).

    Returns: array of shape (num_frames, 33, 3) with normalized x,y,z.
    """
    num_frames = len(frames)
    arr = np.zeros((num_frames, 33, 3))

    for i, frame in enumerate(frames):
        for j, lm in enumerate(frame["landmarks"]):
            arr[i, j, 0] = lm["x"]
            arr[i, j, 1] = lm["y"]
            arr[i, j, 2] = lm["z"]

    # Center on hip midpoint (landmarks 23, 24)
    hip_mid = (arr[:, 23, :] + arr[:, 24, :]) / 2  # (N, 3)
    arr -= hip_mid[:, np.newaxis, :]

    # Scale: use torso length (hip midpoint to shoulder midpoint) as unit
    shoulder_mid = (arr[:, 11, :] + arr[:, 12, :]) / 2  # (N, 3)
    # hip_mid is now at origin, so torso length = distance to shoulder_mid
    torso_lengths = np.linalg.norm(shoulder_mid[:, :2], axis=1)  # use x,y only
    median_torso = np.median(torso_lengths)
    if median_torso > 0.001:
        arr /= median_torso

    return arr


def resample_frames(arr: np.ndarray, target_length: int) -> np.ndarray:
    """Resample a (N, 33, 3) array to target_length frames using linear interpolation."""
    n = arr.shape[0]
    if n == target_length:
        return arr

    old_indices = np.linspace(0, 1, n)
    new_indices = np.linspace(0, 1, target_length)

    # Interpolate each landmark coordinate independently
    result = np.zeros((target_length, 33, 3))
    for j in range(33):
        for k in range(3):
            result[:, j, k] = np.interp(new_indices, old_indices, arr[:, j, k])

    return result


def compute_median_skeleton(all_skeleton_data: list[dict], target_fps: float = 30.0) -> dict:
    """Compute a median skeleton from multiple performers.

    Steps:
    1. Normalize each skeleton (center on hips, scale to unit torso)
    2. Resample all to the same number of frames (median duration)
    3. Compute per-frame median across all performers
    4. Convert back to 0-1 coordinate space for rendering

    Returns a skeleton data dict with the median frames.
    """
    if not all_skeleton_data:
        return None

    print(f"\n  Computing median skeleton from {len(all_skeleton_data)} performers...")

    # Normalize all skeletons
    normalized = []
    frame_counts = []
    for data in all_skeleton_data:
        arr = normalize_skeleton_frames(data["frames"])
        normalized.append(arr)
        frame_counts.append(len(arr))

    # Use median frame count as target length
    target_length = int(np.median(frame_counts))
    print(f"  Frame counts: min={min(frame_counts)}, median={target_length}, max={max(frame_counts)}")

    # Resample all to same length
    resampled = []
    for arr in normalized:
        resampled.append(resample_frames(arr, target_length))

    # Stack and compute median across performers
    stacked = np.stack(resampled, axis=0)  # (num_performers, target_length, 33, 3)
    median_arr = np.median(stacked, axis=0)  # (target_length, 33, 3)

    # Convert back to 0-1 space for rendering:
    # Shift so all coordinates are positive, then scale to fit in 0-1
    for k in range(3):  # x, y, and z
        col_min = median_arr[:, :, k].min()
        col_max = median_arr[:, :, k].max()
        col_range = col_max - col_min
        if col_range > 0.001:
            median_arr[:, :, k] = (median_arr[:, :, k] - col_min) / col_range
            # Add margins (10% on each side)
            median_arr[:, :, k] = 0.1 + median_arr[:, :, k] * 0.8

    # Build output frames
    frames_out = []
    for i in range(target_length):
        frame_landmarks = []
        for j in range(33):
            frame_landmarks.append({
                "x": round(float(median_arr[i, j, 0]), 5),
                "y": round(float(median_arr[i, j, 1]), 5),
                "z": round(float(median_arr[i, j, 2]), 5),
                "visibility": 0.95,  # median skeleton has high confidence
            })
        frames_out.append({
            "frame": i,
            "timestamp": round(i / target_fps, 4),
            "landmarks": frame_landmarks,
            "avg_confidence": 0.95,
        })

    # Average quality across all source videos
    avg_quality = float(np.mean([d["quality_score"] for d in all_skeleton_data]))

    sources = [d["source_file"] for d in all_skeleton_data]
    print(f"  Median skeleton: {target_length} frames from {len(sources)} sources")

    return {
        "exercise": all_skeleton_data[0]["exercise"],
        "source_file": f"median_of_{len(sources)}_performers",
        "source_files": sources,
        "num_performers": len(sources),
        "fps": target_fps,
        "total_frames": target_length,
        "duration_seconds": round(target_length / target_fps, 2),
        "quality_score": round(avg_quality, 4),
        "landmark_names": LANDMARK_NAMES,
        "frames": frames_out,
    }


def save_json(data: dict, output_path: str):
    """Save skeleton data to JSON file."""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(data, f)
    size_kb = os.path.getsize(output_path) / 1024
    print(f"  Saved: {output_path} ({size_kb:.1f} KB)")


def process_exercise_folder(
    folder_path: str,
    exercise_name: str,
    camera_filter: str = "Camera18",
    min_confidence: float = 0.5,
    target_fps: int = 15,
) -> dict | None:
    """Process all videos in an exercise folder and compute median skeleton.

    Args:
        folder_path: Path to Ex1/, Ex2/, etc.
        exercise_name: Name for this exercise (e.g. "ex1").
        camera_filter: Only use videos matching this camera (e.g. "Camera18").
                       Set to None to use all cameras.
        min_confidence: Minimum landmark confidence to keep a frame.
        target_fps: Output FPS (also used for downsampling during extraction).
    """
    video_extensions = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
    all_videos = sorted([
        f for f in Path(folder_path).iterdir()
        if f.suffix.lower() in video_extensions
    ])

    # Filter by camera angle if specified
    if camera_filter:
        videos = [v for v in all_videos if camera_filter.lower() in v.name.lower()]
        print(f"\n{'='*60}")
        print(f"Exercise: {exercise_name} ({os.path.basename(folder_path)})")
        print(f"  {len(all_videos)} total videos, {len(videos)} matching {camera_filter}")
        print(f"{'='*60}")
    else:
        videos = all_videos
        print(f"\n{'='*60}")
        print(f"Exercise: {exercise_name} ({os.path.basename(folder_path)})")
        print(f"  {len(videos)} videos")
        print(f"{'='*60}")

    if not videos:
        print(f"  No matching videos found!")
        return None

    # Extract skeleton from each video
    all_extractions = []
    for video_path in videos:
        data = extract_skeleton(
            str(video_path),
            exercise_name=exercise_name,
            min_confidence=min_confidence,
            target_fps=target_fps,
        )
        if data and data["total_frames"] > 10:  # skip very short/failed extractions
            all_extractions.append(data)

    if not all_extractions:
        print(f"  No valid extractions for {exercise_name}!")
        return None

    print(f"\n  Successfully extracted {len(all_extractions)} / {len(videos)} videos")

    # Compute median skeleton from all performers
    if len(all_extractions) == 1:
        print(f"  Only 1 performer — using directly (no median needed)")
        return all_extractions[0]

    return compute_median_skeleton(all_extractions, target_fps=target_fps)


def batch_process_dataset(
    input_dir: str,
    output_dir: str,
    camera_filter: str = "Camera18",
    min_confidence: float = 0.5,
    target_fps: int = 15,
):
    """Process the full Zenodo dataset organized as Ex1/...Ex6/ subfolders.

    For each exercise folder, processes all performer videos and computes
    a median skeleton for the best possible reference.
    """
    input_path = Path(input_dir)

    # Find exercise subfolders (Ex1, Ex2, etc.)
    exercise_dirs = sorted([
        d for d in input_path.iterdir()
        if d.is_dir() and re.match(r"Ex\d+", d.name, re.IGNORECASE)
    ])

    if not exercise_dirs:
        # No Ex* subfolders — try flat folder mode
        print("No Ex* subfolders found. Trying flat folder mode...")
        flat_batch_process(input_dir, output_dir, min_confidence, target_fps)
        return

    print(f"Found {len(exercise_dirs)} exercise folders: {[d.name for d in exercise_dirs]}")
    print(f"Camera filter: {camera_filter or 'all cameras'}")
    print(f"Target FPS: {target_fps}")
    print(f"Min confidence: {min_confidence}")

    os.makedirs(output_dir, exist_ok=True)
    results = {}

    for ex_dir in exercise_dirs:
        exercise_name = ex_dir.name.lower()  # "ex1", "ex2", etc.
        data = process_exercise_folder(
            str(ex_dir),
            exercise_name=exercise_name,
            camera_filter=camera_filter,
            min_confidence=min_confidence,
            target_fps=target_fps,
        )
        if data:
            output_path = os.path.join(output_dir, f"{exercise_name}_reference.json")
            save_json(data, output_path)
            results[exercise_name] = {
                "frames": data["total_frames"],
                "duration": data["duration_seconds"],
                "quality": data["quality_score"],
                "performers": data.get("num_performers", 1),
            }

    # Summary
    print(f"\n{'='*60}")
    print(f"DONE — {len(results)} exercises processed")
    print(f"{'='*60}")
    for name, info in results.items():
        print(f"  {name}: {info['frames']} frames, {info['duration']}s, "
              f"quality={info['quality']}, from {info['performers']} performers")
    print(f"\nOutput directory: {output_dir}")


def flat_batch_process(input_dir: str, output_dir: str, min_confidence: float, target_fps: int):
    """Fallback: process a flat folder of videos (no subfolders)."""
    video_extensions = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
    videos = sorted([
        f for f in Path(input_dir).iterdir()
        if f.suffix.lower() in video_extensions
    ])

    if not videos:
        print(f"No video files found in {input_dir}")
        return

    print(f"Found {len(videos)} video files\n")

    best_per_exercise = {}
    for video_path in videos:
        name = Path(video_path).stem.lower()
        clean = re.sub(r"[-_ ]*(camera\d+|transposed|\d+fps)[-_ ]*", "_", name, flags=re.IGNORECASE)
        clean = re.sub(r"_+", "_", clean).strip("_")

        data = extract_skeleton(str(video_path), min_confidence=min_confidence, target_fps=target_fps)
        if data is None:
            continue

        exercise = data["exercise"]
        quality = data["quality_score"]
        if exercise not in best_per_exercise or quality > best_per_exercise[exercise][0]:
            best_per_exercise[exercise] = (quality, data)
        print()

    os.makedirs(output_dir, exist_ok=True)
    for exercise, (quality, data) in best_per_exercise.items():
        output_path = os.path.join(output_dir, f"{exercise}_reference.json")
        save_json(data, output_path)


def main():
    parser = argparse.ArgumentParser(
        description="Extract skeleton data from exercise videos using MediaPipe Pose.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process Zenodo dataset (Ex1-Ex6 subfolders)
  python skeleton_extractor.py --input_dir ./videos --output_dir ./skeleton_data

  # Use Camera17 instead of Camera18
  python skeleton_extractor.py --input_dir ./videos --camera Camera17

  # Use all cameras (both angles)
  python skeleton_extractor.py --input_dir ./videos --camera all

  # Single video extraction
  python skeleton_extractor.py -i video.mp4 -o skeleton_data/exercise.json
        """,
    )
    parser.add_argument("--input", "-i", help="Path to a single video file")
    parser.add_argument("--output", "-o", help="Output JSON path (for single video)")
    parser.add_argument("--input_dir", help="Directory with Ex1-Ex6 subfolders (or flat video folder)")
    parser.add_argument("--output_dir", default="skeleton_data", help="Output directory (default: skeleton_data)")
    parser.add_argument("--exercise", help="Exercise name (auto-detected if omitted)")
    parser.add_argument("--camera", default="Camera18", help="Camera filter: 'Camera17', 'Camera18', or 'all' (default: Camera18)")
    parser.add_argument("--min_confidence", type=float, default=0.5, help="Min landmark confidence (default: 0.5)")
    parser.add_argument("--target_fps", type=int, default=15, help="Output FPS (default: 15)")
    parser.add_argument("--start", type=float, default=None, help="Start time in seconds (for single video)")
    parser.add_argument("--end", type=float, default=None, help="End time in seconds (for single video)")
    args = parser.parse_args()

    camera = None if args.camera.lower() == "all" else args.camera

    if args.input_dir:
        batch_process_dataset(
            args.input_dir, args.output_dir,
            camera_filter=camera,
            min_confidence=args.min_confidence,
            target_fps=args.target_fps,
        )
    elif args.input:
        output = args.output or os.path.join(args.output_dir, "extracted_reference.json")
        data = extract_skeleton(
            args.input,
            exercise_name=args.exercise,
            min_confidence=args.min_confidence,
            target_fps=args.target_fps,
            start_sec=args.start,
            end_sec=args.end,
        )
        if data:
            save_json(data, output)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
