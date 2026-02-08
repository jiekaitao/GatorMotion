from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, Optional, Tuple

import cv2
import numpy as np

# MediaPipe Pose index mapping used by webcam mode.
MEDIAPIPE_INDEX_BY_JOINT: Dict[str, int] = {
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_elbow": 13,
    "right_elbow": 14,
    "left_wrist": 15,
    "right_wrist": 16,
    "left_hip": 23,
    "right_hip": 24,
    "left_knee": 25,
    "right_knee": 26,
    "left_ankle": 27,
    "right_ankle": 28,
}


@dataclass(frozen=True)
class SkeletonFrame:
    source: str
    timestamp: float
    exercise: str
    depth_mode: Optional[str]
    joints_3d: Dict[str, Tuple[float, float, float]]
    all_joints_3d: Dict[str, Tuple[float, float, float]]
    keypoints_2d: Dict[str, Tuple[float, float]]
    point_depths_m: Dict[str, float]
    camera_intrinsics: Optional[Tuple[float, float, float, float]]
    camera_resolution: Optional[Tuple[int, int]]
    camera_points_3d: Dict[str, Tuple[float, float, float]]
    video_frame_bgr: Optional[np.ndarray]
    video_width: Optional[int]
    video_height: Optional[int]
    # Optional 33-slot list that mirrors MediaPipe Pose landmark indexing.
    mediapipe_pose_like: List[Optional[Dict[str, float]]]


def _as_xyz(values: object, joint_name: str) -> Tuple[float, float, float]:
    if not isinstance(values, (list, tuple)) or len(values) != 3:
        raise ValueError(f"Joint '{joint_name}' must be a 3-element array")

    xyz: List[float] = []
    for index, raw_value in enumerate(values):
        if not isinstance(raw_value, (int, float)):
            raise ValueError(
                f"Joint '{joint_name}' coordinate at index {index} must be numeric"
            )
        xyz.append(float(raw_value))
    return xyz[0], xyz[1], xyz[2]


def _project_to_normalized_2d(
    joints_3d: Mapping[str, Tuple[float, float, float]]
) -> Dict[str, Tuple[float, float]]:
    if not joints_3d:
        return {}

    xs = [coords[0] for coords in joints_3d.values()]
    ys = [coords[1] for coords in joints_3d.values()]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    width = max(max_x - min_x, 1e-6)
    height = max(max_y - min_y, 1e-6)

    projected: Dict[str, Tuple[float, float]] = {}
    for name, (x, y, _z) in joints_3d.items():
        nx = (x - min_x) / width
        ny = (y - min_y) / height
        projected[name] = (nx, ny)
    return projected


def _build_mediapipe_pose_like(
    joints_3d: Mapping[str, Tuple[float, float, float]],
    keypoints_2d: Mapping[str, Tuple[float, float]],
) -> List[Optional[Dict[str, float]]]:
    pose_like: List[Optional[Dict[str, float]]] = [None] * 33
    for joint_name, mp_index in MEDIAPIPE_INDEX_BY_JOINT.items():
        if joint_name not in joints_3d or joint_name not in keypoints_2d:
            continue
        x, y = keypoints_2d[joint_name]
        _, _, z = joints_3d[joint_name]
        pose_like[mp_index] = {
            "x": float(x),
            "y": float(y),
            "z": float(z),
            "visibility": 1.0,
        }
    return pose_like


def _parse_all_joints(
    joints_obj: object,
) -> Dict[str, Tuple[float, float, float]]:
    if joints_obj is None:
        return {}
    if not isinstance(joints_obj, Mapping):
        raise ValueError("'all_joints' must be an object")

    output: Dict[str, Tuple[float, float, float]] = {}
    for joint_name, raw_xyz in joints_obj.items():
        output[str(joint_name)] = _as_xyz(raw_xyz, str(joint_name))
    return output


def _parse_keypoints_2d(
    payload: Mapping[str, object],
) -> Dict[str, Tuple[float, float]]:
    keypoints_obj = payload.get("keypoints_2d")
    if keypoints_obj is None:
        return {}
    if not isinstance(keypoints_obj, Mapping):
        raise ValueError("'keypoints_2d' must be an object")

    keypoints_2d: Dict[str, Tuple[float, float]] = {}
    for joint_name, raw_xy in keypoints_obj.items():
        if not isinstance(raw_xy, (list, tuple)) or len(raw_xy) != 2:
            raise ValueError(f"'keypoints_2d.{joint_name}' must be a 2-element array")
        x_raw, y_raw = raw_xy
        if not isinstance(x_raw, (int, float)) or not isinstance(y_raw, (int, float)):
            raise ValueError(f"'keypoints_2d.{joint_name}' coordinates must be numeric")
        keypoints_2d[str(joint_name)] = (float(x_raw), float(y_raw))
    return keypoints_2d


def _parse_point_depths_m(payload: Mapping[str, object]) -> Dict[str, float]:
    depths_obj = payload.get("point_depths_m")
    if depths_obj is None:
        return {}
    if not isinstance(depths_obj, Mapping):
        raise ValueError("'point_depths_m' must be an object")

    point_depths_m: Dict[str, float] = {}
    for joint_name, raw_depth in depths_obj.items():
        if not isinstance(raw_depth, (int, float)):
            raise ValueError(f"'point_depths_m.{joint_name}' must be numeric")
        depth_m = float(raw_depth)
        if depth_m <= 0.0:
            continue
        point_depths_m[str(joint_name)] = depth_m
    return point_depths_m


def _parse_camera_intrinsics(
    payload: Mapping[str, object],
) -> Optional[Tuple[float, float, float, float]]:
    raw_intrinsics = payload.get("camera_intrinsics")
    if raw_intrinsics is None:
        return None
    if not isinstance(raw_intrinsics, (list, tuple)) or len(raw_intrinsics) != 4:
        raise ValueError("'camera_intrinsics' must be a 4-element array [fx, fy, cx, cy]")

    fx_raw, fy_raw, cx_raw, cy_raw = raw_intrinsics
    if not all(isinstance(value, (int, float)) for value in (fx_raw, fy_raw, cx_raw, cy_raw)):
        raise ValueError("'camera_intrinsics' values must be numeric")

    fx = float(fx_raw)
    fy = float(fy_raw)
    cx = float(cx_raw)
    cy = float(cy_raw)
    if fx <= 1e-6 or fy <= 1e-6:
        return None
    return (fx, fy, cx, cy)


def _parse_camera_resolution(
    payload: Mapping[str, object],
) -> Optional[Tuple[int, int]]:
    raw_width = payload.get("camera_width")
    raw_height = payload.get("camera_height")
    if not isinstance(raw_width, (int, float)) or not isinstance(raw_height, (int, float)):
        return None
    width = int(raw_width)
    height = int(raw_height)
    if width <= 0 or height <= 0:
        return None
    return (width, height)


def _reconstruct_camera_points_3d(
    keypoints_2d: Mapping[str, Tuple[float, float]],
    point_depths_m: Mapping[str, float],
    camera_intrinsics: Optional[Tuple[float, float, float, float]],
    camera_resolution: Optional[Tuple[int, int]],
) -> Dict[str, Tuple[float, float, float]]:
    if not point_depths_m:
        return {}

    camera_points_3d: Dict[str, Tuple[float, float, float]] = {}
    if camera_intrinsics is not None and camera_resolution is not None:
        fx, fy, cx, cy = camera_intrinsics
        width, height = camera_resolution
        max_x = max(width - 1, 1)
        max_y = max(height - 1, 1)
        for joint_name, depth_m in point_depths_m.items():
            xy = keypoints_2d.get(joint_name)
            if xy is None:
                continue
            u = float(xy[0]) * float(max_x)
            v = float(xy[1]) * float(max_y)
            x = ((u - cx) * depth_m) / fx
            y = ((v - cy) * depth_m) / fy
            z = depth_m
            camera_points_3d[joint_name] = (x, y, z)
        return camera_points_3d

    for joint_name, depth_m in point_depths_m.items():
        xy = keypoints_2d.get(joint_name)
        if xy is None:
            continue
        camera_points_3d[joint_name] = (float(xy[0]), float(xy[1]), float(depth_m))
    return camera_points_3d


def reconstruct_camera_points_3d(
    keypoints_2d: Mapping[str, Tuple[float, float]],
    point_depths_m: Mapping[str, float],
    camera_intrinsics: Optional[Tuple[float, float, float, float]],
    camera_resolution: Optional[Tuple[int, int]],
) -> Dict[str, Tuple[float, float, float]]:
    """
    Public wrapper used by fusion stages that need to rebuild camera-space
    points after keypoint coordinates are adjusted.
    """
    return _reconstruct_camera_points_3d(
        keypoints_2d=keypoints_2d,
        point_depths_m=point_depths_m,
        camera_intrinsics=camera_intrinsics,
        camera_resolution=camera_resolution,
    )


def _decode_video_frame(payload: Mapping[str, object]) -> Tuple[Optional[np.ndarray], Optional[int], Optional[int]]:
    encoded = payload.get("video_frame_base64")
    if encoded in (None, ""):
        return None, None, None
    if not isinstance(encoded, str):
        raise ValueError("'video_frame_base64' must be a base64 string")

    try:
        raw_bytes = base64.b64decode(encoded, validate=True)
    except Exception as error:
        raise ValueError(f"Invalid 'video_frame_base64': {error}") from error

    frame = cv2.imdecode(np.frombuffer(raw_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Failed to decode 'video_frame_base64' JPEG payload")

    payload_w = payload.get("video_width")
    payload_h = payload.get("video_height")
    width = int(payload_w) if isinstance(payload_w, (int, float)) and payload_w > 0 else int(frame.shape[1])
    height = int(payload_h) if isinstance(payload_h, (int, float)) and payload_h > 0 else int(frame.shape[0])
    return frame, width, height


def adapt_ios_payload(
    payload: Mapping[str, object],
    decode_video_frame: bool = True,
) -> SkeletonFrame:
    required_fields = ("device", "timestamp", "exercise", "joints")
    for field in required_fields:
        if field not in payload:
            raise ValueError(f"Missing required field '{field}'")

    joints_obj = payload["joints"]
    if not isinstance(joints_obj, Mapping):
        raise ValueError("'joints' must be an object")

    joints_3d: Dict[str, Tuple[float, float, float]] = {}
    for joint_name, raw_xyz in joints_obj.items():
        joints_3d[str(joint_name)] = _as_xyz(raw_xyz, str(joint_name))

    all_joints_3d = _parse_all_joints(payload.get("all_joints"))
    for joint_name, coords in joints_3d.items():
        all_joints_3d.setdefault(joint_name, coords)

    default_keypoints_2d = _project_to_normalized_2d(joints_3d)
    payload_keypoints_2d = _parse_keypoints_2d(payload)
    keypoints_2d = dict(default_keypoints_2d)
    keypoints_2d.update(payload_keypoints_2d)
    point_depths_m = _parse_point_depths_m(payload)
    camera_intrinsics = _parse_camera_intrinsics(payload)
    camera_resolution = _parse_camera_resolution(payload)
    camera_points_3d = _reconstruct_camera_points_3d(
        keypoints_2d=keypoints_2d,
        point_depths_m=point_depths_m,
        camera_intrinsics=camera_intrinsics,
        camera_resolution=camera_resolution,
    )
    if decode_video_frame:
        video_frame_bgr, video_width, video_height = _decode_video_frame(payload)
    else:
        video_frame_bgr, video_width, video_height = None, None, None

    return SkeletonFrame(
        source=str(payload["device"]),
        timestamp=float(payload["timestamp"]),
        exercise=str(payload["exercise"]),
        depth_mode=str(payload.get("depth_mode")) if payload.get("depth_mode") is not None else None,
        joints_3d=joints_3d,
        all_joints_3d=all_joints_3d,
        keypoints_2d=keypoints_2d,
        point_depths_m=point_depths_m,
        camera_intrinsics=camera_intrinsics,
        camera_resolution=camera_resolution,
        camera_points_3d=camera_points_3d,
        video_frame_bgr=video_frame_bgr,
        video_width=video_width,
        video_height=video_height,
        mediapipe_pose_like=_build_mediapipe_pose_like(joints_3d, keypoints_2d),
    )


def adapt_mediapipe_pose_landmarks(
    landmarks: Iterable[object],
    timestamp: float,
    exercise: str,
) -> SkeletonFrame:
    indexed_landmarks = list(landmarks)
    joints_3d: Dict[str, Tuple[float, float, float]] = {}
    keypoints_2d: Dict[str, Tuple[float, float]] = {}

    for joint_name, mp_index in MEDIAPIPE_INDEX_BY_JOINT.items():
        if mp_index >= len(indexed_landmarks):
            continue
        landmark = indexed_landmarks[mp_index]
        x = float(getattr(landmark, "x"))
        y = float(getattr(landmark, "y"))
        z = float(getattr(landmark, "z", 0.0))
        joints_3d[joint_name] = (x, y, z)
        keypoints_2d[joint_name] = (x, y)

    if "left_hip" in joints_3d and "right_hip" in joints_3d:
        left = joints_3d["left_hip"]
        right = joints_3d["right_hip"]
        joints_3d["root"] = (
            (left[0] + right[0]) / 2.0,
            (left[1] + right[1]) / 2.0,
            (left[2] + right[2]) / 2.0,
        )
        keypoints_2d["root"] = (
            (keypoints_2d["left_hip"][0] + keypoints_2d["right_hip"][0]) / 2.0,
            (keypoints_2d["left_hip"][1] + keypoints_2d["right_hip"][1]) / 2.0,
        )

    return SkeletonFrame(
        source="opencv_webcam",
        timestamp=float(timestamp),
        exercise=exercise,
        depth_mode=None,
        joints_3d=joints_3d,
        all_joints_3d=dict(joints_3d),
        keypoints_2d=keypoints_2d,
        point_depths_m={},
        camera_intrinsics=None,
        camera_resolution=None,
        camera_points_3d={},
        video_frame_bgr=None,
        video_width=None,
        video_height=None,
        mediapipe_pose_like=_build_mediapipe_pose_like(joints_3d, keypoints_2d),
    )


def to_pipeline_payload(frame: SkeletonFrame) -> Dict[str, object]:
    return {
        "device": frame.source,
        "timestamp": frame.timestamp,
        "exercise": frame.exercise,
        "joints_3d": {
            name: [coords[0], coords[1], coords[2]]
            for name, coords in frame.joints_3d.items()
        },
        "all_joints_3d": {
            name: [coords[0], coords[1], coords[2]]
            for name, coords in frame.all_joints_3d.items()
        },
        "keypoints": {
            name: [coords[0], coords[1]]
            for name, coords in frame.keypoints_2d.items()
        },
        "point_depths_m": dict(frame.point_depths_m),
        "camera_intrinsics": list(frame.camera_intrinsics) if frame.camera_intrinsics else None,
        "camera_width": frame.camera_resolution[0] if frame.camera_resolution else None,
        "camera_height": frame.camera_resolution[1] if frame.camera_resolution else None,
        "camera_points_3d": {
            name: [coords[0], coords[1], coords[2]]
            for name, coords in frame.camera_points_3d.items()
        },
        "depth_mode": frame.depth_mode,
        "video_width": frame.video_width,
        "video_height": frame.video_height,
    }
