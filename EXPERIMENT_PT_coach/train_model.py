#!/usr/bin/env python3
"""Train a lightweight reference-matching model from PT landmark data."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from pt_coach.common import (
    CORRECTION_LANDMARKS,
    FEATURE_LANDMARKS,
    PART_BY_INDEX,
    SIDE_BY_INDEX,
    feature_vector,
    knee_angles_deg,
    landmarks_list_to_np,
    load_reference_json,
    normalize_to_body_frame,
)


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


def train(reference_json: Path, model_out: Path, metadata_out: Path) -> None:
    data = load_reference_json(reference_json)
    frames = data["frames"]

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
    for idx in CORRECTION_LANDMARKS:
        tol_x = float(np.percentile(diffs[:, idx, 0], 90) * 2.0 + 0.03)
        tol_y = float(np.percentile(diffs[:, idx, 1], 90) * 2.0 + 0.04)
        tol[idx] = {
            "x": max(0.05, tol_x),
            "y": max(0.08, tol_y),
            "side": SIDE_BY_INDEX[idx],
            "part": PART_BY_INDEX[idx],
        }

    metadata = {
        "exercise_name": "squat",
        "exercise_source": str(reference_json),
        "reference_frames": int(ref_norm.shape[0]),
        "feature_landmarks": FEATURE_LANDMARKS,
        "correction_landmarks": CORRECTION_LANDMARKS,
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
        "--reference-json",
        default="data/raw/squat_reference.json",
        help="Path to downloaded reference landmark JSON",
    )
    parser.add_argument(
        "--model-out",
        default="models/squat_reference_model.npz",
        help="Output path for trained model arrays",
    )
    parser.add_argument(
        "--metadata-out",
        default="models/squat_reference_model.meta.json",
        help="Output path for model metadata",
    )
    args = parser.parse_args()

    train(Path(args.reference_json), Path(args.model_out), Path(args.metadata_out))
