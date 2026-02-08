#!/usr/bin/env python3
"""Shared geometry and feature utilities for the PT coach demo."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

LANDMARK_INDEX = {
    "nose": 0,
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_hip": 23,
    "right_hip": 24,
    "left_knee": 25,
    "right_knee": 26,
    "left_ankle": 27,
    "right_ankle": 28,
    "left_foot_index": 31,
    "right_foot_index": 32,
}

FEATURE_LANDMARKS = [
    LANDMARK_INDEX["left_shoulder"],
    LANDMARK_INDEX["right_shoulder"],
    LANDMARK_INDEX["left_hip"],
    LANDMARK_INDEX["right_hip"],
    LANDMARK_INDEX["left_knee"],
    LANDMARK_INDEX["right_knee"],
    LANDMARK_INDEX["left_ankle"],
    LANDMARK_INDEX["right_ankle"],
    LANDMARK_INDEX["left_foot_index"],
    LANDMARK_INDEX["right_foot_index"],
]

CORRECTION_LANDMARKS = [
    LANDMARK_INDEX["left_knee"],
    LANDMARK_INDEX["right_knee"],
    LANDMARK_INDEX["left_ankle"],
    LANDMARK_INDEX["right_ankle"],
    LANDMARK_INDEX["left_foot_index"],
    LANDMARK_INDEX["right_foot_index"],
]

SIDE_BY_INDEX = {
    LANDMARK_INDEX["left_knee"]: "left",
    LANDMARK_INDEX["right_knee"]: "right",
    LANDMARK_INDEX["left_ankle"]: "left",
    LANDMARK_INDEX["right_ankle"]: "right",
    LANDMARK_INDEX["left_foot_index"]: "left",
    LANDMARK_INDEX["right_foot_index"]: "right",
}

PART_BY_INDEX = {
    LANDMARK_INDEX["left_knee"]: "knee",
    LANDMARK_INDEX["right_knee"]: "knee",
    LANDMARK_INDEX["left_ankle"]: "ankle",
    LANDMARK_INDEX["right_ankle"]: "ankle",
    LANDMARK_INDEX["left_foot_index"]: "foot",
    LANDMARK_INDEX["right_foot_index"]: "foot",
}


def load_reference_json(path: str | Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def landmarks_list_to_np(landmarks: list[dict[str, float]]) -> np.ndarray:
    """Convert landmark dict list to float32 (33, 4): x,y,z,visibility."""
    out = np.zeros((33, 4), dtype=np.float32)
    count = min(33, len(landmarks))
    for i in range(count):
        lm = landmarks[i]
        out[i, 0] = float(lm.get("x", 0.0))
        out[i, 1] = float(lm.get("y", 0.0))
        out[i, 2] = float(lm.get("z", 0.0))
        out[i, 3] = float(lm.get("visibility", 1.0))
    if count < 33:
        out[count:, 3] = 0.0
    return out


def mediapipe_landmarks_to_np(landmarks: list[Any]) -> np.ndarray:
    """Convert MediaPipe landmark objects to float32 (33, 4): x,y,z,visibility."""
    out = np.zeros((33, 4), dtype=np.float32)
    count = min(33, len(landmarks))
    for i in range(count):
        lm = landmarks[i]
        out[i, 0] = float(lm.x)
        out[i, 1] = float(lm.y)
        out[i, 2] = float(lm.z)
        out[i, 3] = float(getattr(lm, "visibility", 1.0))
    if count < 33:
        out[count:, 3] = 0.0
    return out


def _unit(v: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    n = float(np.linalg.norm(v))
    if n < eps:
        return np.array([1.0, 0.0], dtype=np.float32)
    return (v / n).astype(np.float32)


def normalize_to_body_frame(landmarks_xyzw: np.ndarray) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """
    Convert landmarks into a body-centric frame for left/right robust corrections.

    Returns:
      norm_landmarks: (33, 3) -> x_body, y_body, z_scaled
      frame_info: dict with pelvis, axes, scale
    """
    xy = landmarks_xyzw[:, :2].astype(np.float32)
    z = landmarks_xyzw[:, 2].astype(np.float32)

    lhip = xy[LANDMARK_INDEX["left_hip"]]
    rhip = xy[LANDMARK_INDEX["right_hip"]]
    lsh = xy[LANDMARK_INDEX["left_shoulder"]]
    rsh = xy[LANDMARK_INDEX["right_shoulder"]]

    pelvis = (lhip + rhip) * 0.5
    hip_vec = lhip - rhip
    hip_width = float(np.linalg.norm(hip_vec))
    hip_width = max(hip_width, 1e-4)

    x_axis = _unit(hip_vec)

    shoulder_center = (lsh + rsh) * 0.5
    up_guess = shoulder_center - pelvis
    up_proj = up_guess - np.dot(up_guess, x_axis) * x_axis
    if float(np.linalg.norm(up_proj)) < 1e-6:
        up_proj = np.array([-x_axis[1], x_axis[0]], dtype=np.float32)
    y_axis = _unit(up_proj)

    rel = xy - pelvis[None, :]
    x_body = (rel @ x_axis) / hip_width
    y_body = (rel @ y_axis) / hip_width
    z_scaled = z / hip_width

    norm = np.stack([x_body, y_body, z_scaled], axis=1).astype(np.float32)
    info = {
        "pelvis": pelvis,
        "x_axis": x_axis,
        "y_axis": y_axis,
        "scale": np.array([hip_width], dtype=np.float32),
    }
    return norm, info


def feature_vector(norm_landmarks: np.ndarray, feature_indices: list[int]) -> np.ndarray:
    """Flatten selected landmarks into a single feature vector (x_body, y_body, z_scaled)."""
    return norm_landmarks[feature_indices, :].reshape(-1).astype(np.float32)


def compute_joint_angle_deg(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle ABC in degrees in 2D body-frame coordinates."""
    u = a - b
    v = c - b
    un = float(np.linalg.norm(u))
    vn = float(np.linalg.norm(v))
    if un < 1e-6 or vn < 1e-6:
        return 180.0
    cosang = float(np.dot(u, v) / (un * vn))
    cosang = max(-1.0, min(1.0, cosang))
    return float(np.degrees(np.arccos(cosang)))


def knee_angles_deg(norm_landmarks: np.ndarray) -> tuple[float, float, float]:
    lhip = norm_landmarks[LANDMARK_INDEX["left_hip"], :2]
    lknee = norm_landmarks[LANDMARK_INDEX["left_knee"], :2]
    lankle = norm_landmarks[LANDMARK_INDEX["left_ankle"], :2]

    rhip = norm_landmarks[LANDMARK_INDEX["right_hip"], :2]
    rknee = norm_landmarks[LANDMARK_INDEX["right_knee"], :2]
    rankle = norm_landmarks[LANDMARK_INDEX["right_ankle"], :2]

    left = compute_joint_angle_deg(lhip, lknee, lankle)
    right = compute_joint_angle_deg(rhip, rknee, rankle)
    return left, right, (left + right) * 0.5


def moving_average(data: list[float], window: int) -> float:
    if not data:
        return 0.0
    if window <= 1:
        return float(data[-1])
    arr = np.array(data[-window:], dtype=np.float32)
    return float(arr.mean())
