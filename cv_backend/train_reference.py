"""Train reference models from skeleton JSON data.

Adapted from EXPERIMENT_PT_coach/train_model.py.
Provides train() for individual model training and ensure_models_exist()
for auto-training all available exercises on startup.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from pt_coach.common import (
    FEATURE_LANDMARKS,
    PART_BY_INDEX,
    SIDE_BY_INDEX,
    correction_landmarks_for_exercise,
    feature_vector,
    knee_angles_deg,
    landmarks_list_to_np,
    load_reference_json,
    normalize_to_body_frame,
)
from pt_coach.exercises import EXERCISE_SPECS, get_exercise_spec


def pairwise_distances(x: np.ndarray) -> np.ndarray:
    """Euclidean pairwise distance matrix (N, N)."""
    xx = np.sum(x * x, axis=1, keepdims=True)
    d2 = xx + xx.T - 2.0 * (x @ x.T)
    d2 = np.maximum(d2, 0.0)
    return np.sqrt(d2)


def robust_std(a: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    std = np.std(a, axis=0)
    return np.where(std < eps, 1.0, std)


def train(json_path: str | Path, output_npz: str | Path, output_meta: str | Path | None = None) -> None:
    """Train a reference-matching model from a skeleton JSON file.

    Args:
        json_path: Path to the reference skeleton JSON file.
        output_npz: Path for the output .npz model file.
        output_meta: Path for the output .meta.json file. If None, derived from output_npz.
    """
    json_path = Path(json_path)
    output_npz = Path(output_npz)
    if output_meta is None:
        output_meta = output_npz.with_suffix("").with_suffix(".meta.json")
    else:
        output_meta = Path(output_meta)

    data = load_reference_json(json_path)
    frames = data["frames"]

    # Determine exercise key from filename pattern (e.g. ex1_reference.json -> arm_abduction)
    exercise_key = _exercise_key_from_filename(json_path.name)
    spec = get_exercise_spec(exercise_key)
    correction_landmarks = correction_landmarks_for_exercise(spec.key)

    lm_all = []
    features = []
    avg_knees = []

    for frame in frames:
        lms = landmarks_list_to_np(frame["landmarks"])
        norm_lms, _ = normalize_to_body_frame(lms)
        feat = feature_vector(norm_lms, FEATURE_LANDMARKS)
        _, _, knee_avg = knee_angles_deg(norm_lms)

        lm_all.append(norm_lms)
        features.append(feat)
        avg_knees.append(knee_avg)

    ref_norm = np.stack(lm_all, axis=0).astype(np.float32)   # (N,33,3)
    ref_features = np.stack(features, axis=0).astype(np.float32)  # (N,D)
    ref_knees = np.array(avg_knees, dtype=np.float32)

    feat_mean = np.mean(ref_features, axis=0).astype(np.float32)
    feat_std = robust_std(ref_features).astype(np.float32)
    ref_scaled = ((ref_features - feat_mean[None, :]) / feat_std[None, :]).astype(np.float32)

    # Calibrate distance thresholds from leave-one-out nearest neighbor distances.
    dmat = pairwise_distances(ref_scaled)
    n = dmat.shape[0]
    dmat[np.arange(n), np.arange(n)] = np.inf
    loo_nearest = np.min(dmat, axis=1)

    dist_p50 = float(np.percentile(loo_nearest, 50))
    dist_p90 = float(np.percentile(loo_nearest, 90))
    dist_p99 = float(np.percentile(loo_nearest, 99))

    # Tolerances from smoothed trajectory residual
    tol = {}
    n = ref_norm.shape[0]
    smooth_window = max(3, min(7, n // 30))

    def _smooth_1d(arr: np.ndarray, w: int) -> np.ndarray:
        kernel = np.ones(w, dtype=np.float32) / float(w)
        return np.convolve(arr, kernel, mode="same")

    for idx in correction_landmarks:
        raw_x = ref_norm[:, idx, 0].astype(np.float64)
        raw_y = ref_norm[:, idx, 1].astype(np.float64)
        smooth_x = _smooth_1d(raw_x, smooth_window)
        smooth_y = _smooth_1d(raw_y, smooth_window)
        residual_x = np.abs(raw_x - smooth_x)
        residual_y = np.abs(raw_y - smooth_y)
        tol_x = float(np.percentile(residual_x, 90) * 3.0 + 0.03)
        tol_y = float(np.percentile(residual_y, 90) * 3.0 + 0.04)
        tol[idx] = {
            "x": max(0.05, tol_x),
            "y": max(0.06, tol_y),
            "side": SIDE_BY_INDEX[idx],
            "part": PART_BY_INDEX[idx],
        }

    metadata = {
        "exercise_name": spec.key,
        "exercise_display_name": spec.display_name,
        "exercise_code": spec.code,
        "exercise_source": str(json_path),
        "reference_frames": int(ref_norm.shape[0]),
        "feature_landmarks": FEATURE_LANDMARKS,
        "correction_landmarks": correction_landmarks,
        "distance_calibration": {
            "p50": dist_p50,
            "p90": dist_p90,
            "p99": dist_p99,
        },
        "knee_angle_calibration": {
            "p10": float(np.percentile(ref_knees, 10)),
            "p50": float(np.percentile(ref_knees, 50)),
            "p90": float(np.percentile(ref_knees, 90)),
        },
        "correction_tolerance": {str(k): v for k, v in tol.items()},
        "landmark_names": data.get("landmark_names", []),
        "reference_quality_score": data.get("quality_score", None),
    }

    output_npz.parent.mkdir(parents=True, exist_ok=True)
    output_meta.parent.mkdir(parents=True, exist_ok=True)

    np.savez_compressed(
        output_npz,
        ref_norm=ref_norm,
        ref_features_scaled=ref_scaled,
        feat_mean=feat_mean,
        feat_std=feat_std,
    )
    output_meta.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"  Model saved: {output_npz}")
    print(f"  Metadata saved: {output_meta}")
    print(f"  Distance calibration: p50={dist_p50:.4f}, p90={dist_p90:.4f}, p99={dist_p99:.4f}")


# Build a reverse mapping: repo_file -> exercise_key
_FILENAME_TO_KEY: dict[str, str] = {}
for _key, _spec in EXERCISE_SPECS.items():
    _FILENAME_TO_KEY[_spec.repo_file] = _key
    # Also map the code prefix (e.g. "ex1" -> "arm_abduction")
    _FILENAME_TO_KEY[_spec.code] = _key


def _exercise_key_from_filename(filename: str) -> str:
    """Determine exercise key from a skeleton JSON filename.

    Examples:
        ex1_reference.json -> arm_abduction
        ex6_reference.json -> squat
    """
    if filename in _FILENAME_TO_KEY:
        return _FILENAME_TO_KEY[filename]
    # Try matching by code prefix (e.g. "ex1_something.json" -> "ex1")
    code = filename.split("_")[0]
    if code in _FILENAME_TO_KEY:
        return _FILENAME_TO_KEY[code]
    raise KeyError(f"Cannot determine exercise key from filename: {filename}")


def ensure_models_exist(data_dir: Path, models_dir: Path) -> dict[str, Path]:
    """Scan data_dir for skeleton JSON files and auto-train models if needed.

    Args:
        data_dir: Directory containing skeleton JSON files (e.g. ex1_reference.json)
        models_dir: Directory to store trained model .npz and .meta.json files

    Returns:
        dict mapping exercise_key -> Path to model .npz (only for exercises with data)
    """
    models_dir.mkdir(parents=True, exist_ok=True)
    available: dict[str, Path] = {}

    for key, spec in EXERCISE_SPECS.items():
        reference_json = data_dir / spec.repo_file
        if not reference_json.exists():
            print(f"  [coach] Skipping {key}: no reference data at {reference_json}")
            continue

        model_npz = models_dir / f"{key}_reference_model.npz"
        metadata_json = models_dir / f"{key}_reference_model.meta.json"

        if model_npz.exists() and metadata_json.exists():
            print(f"  [coach] Model for {key} already exists")
            available[key] = model_npz
            continue

        print(f"  [coach] Training model for {key} from {reference_json}...")
        try:
            train(reference_json, model_npz, metadata_json)
            available[key] = model_npz
        except Exception as e:
            print(f"  [coach] Failed to train {key}: {e}")

    return available
