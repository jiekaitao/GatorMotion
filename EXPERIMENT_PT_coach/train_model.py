#!/usr/bin/env python3
"""Train a lightweight reference-matching model from PT landmark data."""

from __future__ import annotations

import argparse
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
from pt_coach.exercises import available_exercises, get_exercise_spec


def pairwise_distances(x: np.ndarray) -> np.ndarray:
    """Squared euclidean pairwise distance matrix (N, N)."""
    # (a-b)^2 = a^2 + b^2 - 2ab
    xx = np.sum(x * x, axis=1, keepdims=True)
    d2 = xx + xx.T - 2.0 * (x @ x.T)
    d2 = np.maximum(d2, 0.0)
    return np.sqrt(d2)


def robust_std(a: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    std = np.std(a, axis=0)
    return np.where(std < eps, 1.0, std)


def train(exercise_key: str, reference_json: Path, model_out: Path, metadata_out: Path) -> None:
    data = load_reference_json(reference_json)
    frames = data["frames"]
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

    ref_norm = np.stack(lm_all, axis=0).astype(np.float32)  # (N,33,3)
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

    # Tolerances for correction deltas from local frame-to-frame motion.
    tol = {}
    diffs = np.abs(np.diff(ref_norm, axis=0))  # (N-1,33,3)
    for idx in correction_landmarks:
        tol_x = float(np.percentile(diffs[:, idx, 0], 90) * 2.0 + 0.03)
        tol_y = float(np.percentile(diffs[:, idx, 1], 90) * 2.0 + 0.04)
        tol[idx] = {
            "x": max(0.05, tol_x),
            "y": max(0.08, tol_y),
            "side": SIDE_BY_INDEX[idx],
            "part": PART_BY_INDEX[idx],
        }

    metadata = {
        "exercise_name": spec.key,
        "exercise_display_name": spec.display_name,
        "exercise_code": spec.code,
        "exercise_source": str(reference_json),
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
        "correction_tolerance": tol,
        "landmark_names": data.get("landmark_names", []),
        "reference_quality_score": data.get("quality_score", None),
    }

    model_out.parent.mkdir(parents=True, exist_ok=True)
    metadata_out.parent.mkdir(parents=True, exist_ok=True)

    np.savez_compressed(
        model_out,
        ref_norm=ref_norm,
        ref_features_scaled=ref_scaled,
        feat_mean=feat_mean,
        feat_std=feat_std,
    )
    metadata_out.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"Model saved: {model_out}")
    print(f"Metadata saved: {metadata_out}")
    print("Distance calibration:")
    print(f"  p50={dist_p50:.4f}, p90={dist_p90:.4f}, p99={dist_p99:.4f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train PT coach reference model")
    parser.add_argument(
        "--exercise",
        default="squat",
        choices=available_exercises(),
        help="Exercise key",
    )
    parser.add_argument(
        "--reference-json",
        default="",
        help="Path to downloaded reference landmark JSON",
    )
    parser.add_argument(
        "--model-out",
        default="",
        help="Output path for trained model arrays",
    )
    parser.add_argument(
        "--metadata-out",
        default="",
        help="Output path for model metadata",
    )
    args = parser.parse_args()

    spec = get_exercise_spec(args.exercise)
    reference_json = Path(args.reference_json) if args.reference_json else Path(f"data/raw/{spec.key}_reference.json")
    model_out = Path(args.model_out) if args.model_out else Path(f"models/{spec.key}_reference_model.npz")
    metadata_out = (
        Path(args.metadata_out)
        if args.metadata_out
        else Path(f"models/{spec.key}_reference_model.meta.json")
    )

    train(spec.key, reference_json, model_out, metadata_out)
