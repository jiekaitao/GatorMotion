from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, replace
import math
from pathlib import Path
import time
from typing import Dict, Mapping, Optional, Tuple

import cv2
import mediapipe as mp
import numpy as np

import config
from backend.skeleton_adapter import (
    MEDIAPIPE_INDEX_BY_JOINT,
    SkeletonFrame,
    adapt_ios_payload,
    adapt_mediapipe_pose_landmarks,
    reconstruct_camera_points_3d,
    to_pipeline_payload,
)
from backend.skeleton_preview import IOSSkeletonPreview
from backend.websocket_server import (
    IOSWebSocketConfig,
    build_websocket_uri,
    consume_remote_skeleton_stream,
    run_skeleton_ws_server,
)

try:
    from pymongo import MongoClient
except Exception:  # pragma: no cover - optional dependency at runtime
    MongoClient = None

try:
    from mediapipe.tasks.python import BaseOptions as MPBaseOptions
    from mediapipe.tasks.python.vision import (
        PoseLandmarker as MPPoseLandmarker,
        PoseLandmarkerOptions as MPPoseLandmarkerOptions,
        RunningMode as MPRunningMode,
    )
    MP_TASKS_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency at runtime
    MP_TASKS_AVAILABLE = False
    MPBaseOptions = None
    MPPoseLandmarker = None
    MPPoseLandmarkerOptions = None
    MPRunningMode = None


def _angle_3d(
    point_a: Tuple[float, float, float],
    point_b: Tuple[float, float, float],
    point_c: Tuple[float, float, float],
) -> float:
    bax, bay, baz = point_a[0] - point_b[0], point_a[1] - point_b[1], point_a[2] - point_b[2]
    bcx, bcy, bcz = point_c[0] - point_b[0], point_c[1] - point_b[1], point_c[2] - point_b[2]

    dot = (bax * bcx) + (bay * bcy) + (baz * bcz)
    norm_ba = math.sqrt((bax * bax) + (bay * bay) + (baz * baz))
    norm_bc = math.sqrt((bcx * bcx) + (bcy * bcy) + (bcz * bcz))

    if norm_ba < 1e-6 or norm_bc < 1e-6:
        return 0.0

    cosine = max(min(dot / (norm_ba * norm_bc), 1.0), -1.0)
    return math.degrees(math.acos(cosine))


def _distance_3d(
    point_a: Tuple[float, float, float],
    point_b: Tuple[float, float, float],
) -> float:
    dx = point_a[0] - point_b[0]
    dy = point_a[1] - point_b[1]
    dz = point_a[2] - point_b[2]
    return math.sqrt((dx * dx) + (dy * dy) + (dz * dz))


def _joint_distance_from_frame(frame: SkeletonFrame, joint_name: str) -> Optional[float]:
    camera_point = frame.camera_points_3d.get(joint_name)
    if camera_point is not None:
        depth = float(camera_point[2])
        if depth > 0.0 and math.isfinite(depth):
            return depth

    depth = frame.point_depths_m.get(joint_name)
    if depth is not None:
        depth_f = float(depth)
        if depth_f > 0.0 and math.isfinite(depth_f):
            return depth_f

    # Fallback: camera-to-joint world distance when per-joint LiDAR depth is unavailable.
    camera_position = frame.camera_position
    joint_world = frame.joints_3d.get(joint_name)
    if camera_position is None or joint_world is None:
        return None
    dx = float(joint_world[0] - camera_position[0])
    dy = float(joint_world[1] - camera_position[1])
    dz = float(joint_world[2] - camera_position[2])
    distance_m = math.sqrt((dx * dx) + (dy * dy) + (dz * dz))
    if distance_m <= 0.0 or not math.isfinite(distance_m):
        return None
    return distance_m


@dataclass
class ArmMotionState:
    filtered_rel_depth_m: Optional[float] = None
    previous_timestamp: Optional[float] = None
    previous_velocity_sign: int = 0
    last_extremum_rel_depth_m: Optional[float] = None
    last_extremum_timestamp: Optional[float] = None
    half_cycle_pending: bool = False
    back_forth_count: int = 0
    last_velocity_mps: float = 0.0


class ArmDepthMotionDetector:
    def __init__(self) -> None:
        self.filter_alpha = config.ARM_DEPTH_FILTER_ALPHA
        self.velocity_deadband_mps = config.ARM_DEPTH_VELOCITY_DEADBAND_MPS
        self.min_half_cycle_amplitude_m = config.ARM_DEPTH_HALF_CYCLE_MIN_AMPLITUDE_M
        self.min_half_cycle_duration_sec = config.ARM_DEPTH_HALF_CYCLE_MIN_DURATION_SEC
        self.arm_states: Dict[str, ArmMotionState] = {
            "left": ArmMotionState(),
            "right": ArmMotionState(),
        }
        self.leg_states: Dict[str, ArmMotionState] = {
            "left": ArmMotionState(),
            "right": ArmMotionState(),
        }

    @staticmethod
    def _joint_depth_from_frame(frame: SkeletonFrame, joint_name: str) -> Optional[float]:
        return _joint_distance_from_frame(frame, joint_name)

    @classmethod
    def _arm_distance_for_side(cls, frame: SkeletonFrame, side: str) -> Optional[float]:
        shoulder_name = f"{side}_shoulder"
        elbow_name = f"{side}_elbow"
        wrist_name = f"{side}_wrist"
        distance_candidates: list[float] = []
        for joint_name in (wrist_name, elbow_name):
            joint_depth = cls._joint_depth_from_frame(frame, joint_name)
            if joint_depth is not None:
                distance_candidates.append(joint_depth)
        if not distance_candidates:
            shoulder_depth = cls._joint_depth_from_frame(frame, shoulder_name)
            if shoulder_depth is not None:
                distance_candidates.append(shoulder_depth)
        if not distance_candidates:
            return None
        return float(sum(distance_candidates) / float(len(distance_candidates)))

    @classmethod
    def _leg_distance_for_side(cls, frame: SkeletonFrame, side: str) -> Optional[float]:
        hip_name = f"{side}_hip"
        knee_name = f"{side}_knee"
        ankle_name = f"{side}_ankle"
        distance_candidates: list[float] = []
        for joint_name in (ankle_name, knee_name):
            joint_depth = cls._joint_depth_from_frame(frame, joint_name)
            if joint_depth is not None:
                distance_candidates.append(joint_depth)
        if not distance_candidates:
            hip_depth = cls._joint_depth_from_frame(frame, hip_name)
            if hip_depth is not None:
                distance_candidates.append(hip_depth)
        if not distance_candidates:
            return None
        return float(sum(distance_candidates) / float(len(distance_candidates)))

    def _update_state(self, state: ArmMotionState, rel_depth_m: float, timestamp: float) -> int:
        if state.filtered_rel_depth_m is None or state.previous_timestamp is None:
            state.filtered_rel_depth_m = rel_depth_m
            state.previous_timestamp = timestamp
            state.last_extremum_rel_depth_m = rel_depth_m
            state.last_extremum_timestamp = timestamp
            state.last_velocity_mps = 0.0
            state.previous_velocity_sign = 0
            return 0

        dt = timestamp - state.previous_timestamp
        if dt <= 1e-6:
            dt = 1e-6

        previous_filtered = state.filtered_rel_depth_m
        filtered = (previous_filtered * (1.0 - self.filter_alpha)) + (rel_depth_m * self.filter_alpha)
        velocity = (filtered - previous_filtered) / dt
        if velocity > self.velocity_deadband_mps:
            velocity_sign = 1
        elif velocity < -self.velocity_deadband_mps:
            velocity_sign = -1
        else:
            velocity_sign = 0

        if (
            velocity_sign != 0
            and state.previous_velocity_sign != 0
            and velocity_sign != state.previous_velocity_sign
        ):
            turning_point = previous_filtered
            if (
                state.last_extremum_rel_depth_m is not None
                and state.last_extremum_timestamp is not None
            ):
                half_cycle_amplitude = abs(turning_point - state.last_extremum_rel_depth_m)
                half_cycle_duration = timestamp - state.last_extremum_timestamp
                if (
                    half_cycle_amplitude >= self.min_half_cycle_amplitude_m
                    and half_cycle_duration >= self.min_half_cycle_duration_sec
                ):
                    if state.half_cycle_pending:
                        state.back_forth_count += 1
                        state.half_cycle_pending = False
                    else:
                        state.half_cycle_pending = True
            state.last_extremum_rel_depth_m = turning_point
            state.last_extremum_timestamp = timestamp

        if velocity_sign != 0:
            state.previous_velocity_sign = velocity_sign
        state.filtered_rel_depth_m = filtered
        state.previous_timestamp = timestamp
        state.last_velocity_mps = velocity
        return velocity_sign

    def update(self, frame: SkeletonFrame) -> Dict[str, float]:
        if frame.timestamp <= 0.0:
            return {}

        output: Dict[str, float] = {}
        for side in ("left", "right"):
            arm_distance_m = self._arm_distance_for_side(frame, side)
            if arm_distance_m is None:
                continue
            state = self.arm_states[side]
            direction_sign = self._update_state(state, arm_distance_m, frame.timestamp)
            filtered_distance = float(state.filtered_rel_depth_m or arm_distance_m)
            velocity = float(state.last_velocity_mps)
            direction = float(direction_sign)
            output[f"{side}_arm_distance_m"] = filtered_distance
            output[f"{side}_arm_distance_velocity_mps"] = velocity
            output[f"{side}_arm_distance_direction"] = direction
            output[f"{side}_arm_back_forth_count"] = float(state.back_forth_count)
            # Backward-compatible keys used by older overlays/consumers.
            output[f"{side}_arm_rel_depth_m"] = filtered_distance
            output[f"{side}_arm_depth_velocity_mps"] = velocity
            output[f"{side}_arm_depth_direction"] = direction

        for side in ("left", "right"):
            leg_distance_m = self._leg_distance_for_side(frame, side)
            if leg_distance_m is None:
                continue
            state = self.leg_states[side]
            direction_sign = self._update_state(state, leg_distance_m, frame.timestamp)
            filtered_distance = float(state.filtered_rel_depth_m or leg_distance_m)
            velocity = float(state.last_velocity_mps)
            direction = float(direction_sign)
            output[f"{side}_leg_distance_m"] = filtered_distance
            output[f"{side}_leg_distance_velocity_mps"] = velocity
            output[f"{side}_leg_distance_direction"] = direction
            output[f"{side}_leg_back_forth_count"] = float(state.back_forth_count)
            # Backward-compatible style aliases.
            output[f"{side}_leg_rel_depth_m"] = filtered_distance
            output[f"{side}_leg_depth_velocity_mps"] = velocity
            output[f"{side}_leg_depth_direction"] = direction
        return output


@dataclass
class BodyPartDistanceState:
    filtered_distance_m: Optional[float] = None
    previous_timestamp: Optional[float] = None
    last_velocity_mps: float = 0.0


class BodyPartDistanceTracker:
    def __init__(self) -> None:
        self.filter_alpha = config.ARM_DEPTH_FILTER_ALPHA
        self.max_per_frame_jump_m = 0.35
        self.states: Dict[str, BodyPartDistanceState] = {}

    def _update_state(self, joint_name: str, distance_m: float, timestamp: float) -> BodyPartDistanceState:
        state = self.states.get(joint_name)
        if state is None:
            state = BodyPartDistanceState(
                filtered_distance_m=distance_m,
                previous_timestamp=timestamp,
                last_velocity_mps=0.0,
            )
            self.states[joint_name] = state
            return state

        previous_filtered = state.filtered_distance_m
        previous_timestamp = state.previous_timestamp
        if previous_filtered is None or previous_timestamp is None:
            state.filtered_distance_m = distance_m
            state.previous_timestamp = timestamp
            state.last_velocity_mps = 0.0
            return state

        dt = timestamp - previous_timestamp
        if dt <= 1e-6:
            dt = 1e-6

        clamped_distance = min(
            max(distance_m, previous_filtered - self.max_per_frame_jump_m),
            previous_filtered + self.max_per_frame_jump_m,
        )
        filtered = (previous_filtered * (1.0 - self.filter_alpha)) + (clamped_distance * self.filter_alpha)
        state.last_velocity_mps = (filtered - previous_filtered) / dt
        state.filtered_distance_m = filtered
        state.previous_timestamp = timestamp
        return state

    def update(self, frame: SkeletonFrame) -> Dict[str, float]:
        if frame.timestamp <= 0.0:
            return {}
        if not frame.source.startswith("ios"):
            return {}
        if not frame.joints_3d:
            return {}

        metrics: Dict[str, float] = {}
        for joint_name in sorted(frame.joints_3d.keys()):
            distance_m = _joint_distance_from_frame(frame, joint_name)
            if distance_m is None:
                continue
            state = self._update_state(joint_name, distance_m, frame.timestamp)
            filtered = state.filtered_distance_m
            if filtered is None:
                continue
            metrics[f"{joint_name}_distance_m"] = float(filtered)
            metrics[f"{joint_name}_distance_velocity_mps"] = float(state.last_velocity_mps)
        return metrics


class ExercisePipeline:
    """
    Shared processor for webcam and iOS LiDAR skeleton streams.
    """

    def __init__(self) -> None:
        self.frame_index = 0
        self.templates_cache: Dict[str, Dict[str, object]] = {}
        self.previous_ios_joints_3d: Optional[Dict[str, Tuple[float, float, float]]] = None
        self.arm_depth_motion_detector = ArmDepthMotionDetector()
        self.body_part_distance_tracker = BodyPartDistanceTracker()

        self.mongo_client = None
        self.db = None
        self.sessions_collection = None
        self.templates_collection = None

        if MongoClient and config.MONGODB_URI:
            try:
                self.mongo_client = MongoClient(
                    config.MONGODB_URI,
                    serverSelectionTimeoutMS=1500,
                )
                self.mongo_client.admin.command("ping")
                self.db = self.mongo_client[config.MONGODB_DATABASE]
                self.sessions_collection = self.db[config.SESSIONS_COLLECTION]
                self.templates_collection = self.db[config.EXERCISE_TEMPLATES_COLLECTION]
                print("[MongoDB] Connected.")
            except Exception as error:
                print(f"[MongoDB] Disabled ({error})")
                self.mongo_client = None
                self.db = None

    @staticmethod
    def _project_joints_to_normalized_2d(
        joints_3d: Mapping[str, Tuple[float, float, float]],
    ) -> Dict[str, Tuple[float, float]]:
        if not joints_3d:
            return {}
        xs = [coords[0] for coords in joints_3d.values()]
        ys = [coords[1] for coords in joints_3d.values()]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        width = max(max_x - min_x, 1e-6)
        height = max(max_y - min_y, 1e-6)
        return {
            name: ((coords[0] - min_x) / width, (coords[1] - min_y) / height)
            for name, coords in joints_3d.items()
        }

    def _stabilize_ios_frame(self, frame: SkeletonFrame) -> SkeletonFrame:
        if config.IOS_DISABLE_JOINT_STABILIZATION:
            return frame
        if frame.source not in {"ios_lidar", "ios_lidar+mediapipe"}:
            return frame
        if not frame.joints_3d:
            return frame

        previous = self.previous_ios_joints_3d
        self.previous_ios_joints_3d = dict(frame.joints_3d)
        if not previous:
            return frame

        alpha = config.IOS_JOINT_SMOOTHING_ALPHA
        max_jump_m = config.IOS_JOINT_MAX_JUMP_M
        stabilized: Dict[str, Tuple[float, float, float]] = {}
        for joint_name, current in frame.joints_3d.items():
            prev = previous.get(joint_name)
            if prev is None:
                stabilized[joint_name] = current
                continue
            if _distance_3d(current, prev) > max_jump_m:
                stabilized[joint_name] = prev
                continue
            stabilized[joint_name] = (
                (prev[0] * (1.0 - alpha)) + (current[0] * alpha),
                (prev[1] * (1.0 - alpha)) + (current[1] * alpha),
                (prev[2] * (1.0 - alpha)) + (current[2] * alpha),
            )

        self.previous_ios_joints_3d = dict(stabilized)
        all_joints = dict(frame.all_joints_3d)
        for joint_name, coords in stabilized.items():
            all_joints[joint_name] = coords
        keypoints_2d = self._project_joints_to_normalized_2d(stabilized)
        return replace(
            frame,
            joints_3d=stabilized,
            all_joints_3d=all_joints,
            keypoints_2d=keypoints_2d,
        )

    def evaluate_frame(self, frame: SkeletonFrame) -> Tuple[str, Dict[str, float]]:
        frame = self._stabilize_ios_frame(frame)
        metrics = self._extract_metrics(frame)
        if frame.arm_head_distance_m is not None:
            metrics["arm_head_distance_m"] = float(frame.arm_head_distance_m)
        if frame.arm_head_quality is not None:
            metrics["arm_head_quality"] = float(frame.arm_head_quality)
        if frame.arm_head_state in {"near", "mid", "far"}:
            state_index = {"near": 0.0, "mid": 1.0, "far": 2.0}[frame.arm_head_state]
            metrics["arm_head_state_idx"] = state_index
        metrics.update(self.body_part_distance_tracker.update(frame))
        metrics.update(self.arm_depth_motion_detector.update(frame))
        feedback = self._compare_with_template(frame.exercise, metrics)
        self._log_session(frame, metrics, feedback)
        self.frame_index += 1
        return feedback, metrics

    def process_frame(self, frame: SkeletonFrame) -> str:
        feedback, _ = self.evaluate_frame(frame)
        return feedback

    def _extract_metrics(self, frame: SkeletonFrame) -> Dict[str, float]:
        joints = frame.joints_3d
        metrics: Dict[str, float] = {}

        if all(key in joints for key in ("left_hip", "left_knee", "left_ankle")):
            metrics["left_knee_angle_deg"] = _angle_3d(
                joints["left_hip"], joints["left_knee"], joints["left_ankle"]
            )

        if all(key in joints for key in ("right_hip", "right_knee", "right_ankle")):
            metrics["right_knee_angle_deg"] = _angle_3d(
                joints["right_hip"], joints["right_knee"], joints["right_ankle"]
            )

        if all(key in joints for key in ("left_shoulder", "left_hip", "left_knee")):
            metrics["left_hip_angle_deg"] = _angle_3d(
                joints["left_shoulder"], joints["left_hip"], joints["left_knee"]
            )

        if all(key in joints for key in ("right_shoulder", "right_hip", "right_knee")):
            metrics["right_hip_angle_deg"] = _angle_3d(
                joints["right_shoulder"], joints["right_hip"], joints["right_knee"]
            )

        if all(key in joints for key in ("left_shoulder", "left_elbow", "left_wrist")):
            metrics["left_elbow_angle_deg"] = _angle_3d(
                joints["left_shoulder"], joints["left_elbow"], joints["left_wrist"]
            )

        if all(key in joints for key in ("right_shoulder", "right_elbow", "right_wrist")):
            metrics["right_elbow_angle_deg"] = _angle_3d(
                joints["right_shoulder"], joints["right_elbow"], joints["right_wrist"]
            )

        if all(key in joints for key in ("left_shoulder", "right_shoulder", "root")):
            shoulder_center = (
                (joints["left_shoulder"][0] + joints["right_shoulder"][0]) / 2.0,
                (joints["left_shoulder"][1] + joints["right_shoulder"][1]) / 2.0,
                (joints["left_shoulder"][2] + joints["right_shoulder"][2]) / 2.0,
            )
            root = joints["root"]
            metrics["torso_forward_offset_m"] = shoulder_center[2] - root[2]

        if all(key in joints for key in ("left_shoulder", "right_shoulder")):
            ls, rs = joints["left_shoulder"], joints["right_shoulder"]
            metrics["shoulder_width_m"] = math.sqrt(
                ((ls[0] - rs[0]) ** 2) + ((ls[1] - rs[1]) ** 2) + ((ls[2] - rs[2]) ** 2)
            )

        if all(key in joints for key in ("left_hip", "right_hip")):
            lh, rh = joints["left_hip"], joints["right_hip"]
            metrics["hip_width_m"] = math.sqrt(
                ((lh[0] - rh[0]) ** 2) + ((lh[1] - rh[1]) ** 2) + ((lh[2] - rh[2]) ** 2)
            )

        if all(key in joints for key in ("left_ankle", "right_ankle")):
            la, ra = joints["left_ankle"], joints["right_ankle"]
            metrics["stance_width_m"] = _distance_3d(la, ra)

        if all(key in joints for key in ("left_knee", "left_ankle", "left_foot_index")):
            metrics["left_ankle_angle_deg"] = _angle_3d(
                joints["left_knee"], joints["left_ankle"], joints["left_foot_index"]
            )

        if all(key in joints for key in ("right_knee", "right_ankle", "right_foot_index")):
            metrics["right_ankle_angle_deg"] = _angle_3d(
                joints["right_knee"], joints["right_ankle"], joints["right_foot_index"]
            )

        distance_pairs = (
            ("left_upper_arm_length_m", "left_shoulder", "left_elbow"),
            ("right_upper_arm_length_m", "right_shoulder", "right_elbow"),
            ("left_forearm_length_m", "left_elbow", "left_wrist"),
            ("right_forearm_length_m", "right_elbow", "right_wrist"),
            ("left_thigh_length_m", "left_hip", "left_knee"),
            ("right_thigh_length_m", "right_hip", "right_knee"),
            ("left_shin_length_m", "left_knee", "left_ankle"),
            ("right_shin_length_m", "right_knee", "right_ankle"),
            ("left_side_body_length_m", "left_shoulder", "left_hip"),
            ("right_side_body_length_m", "right_shoulder", "right_hip"),
            ("left_foot_length_m", "left_heel", "left_foot_index"),
            ("right_foot_length_m", "right_heel", "right_foot_index"),
            ("head_to_neck_m", "nose", "neck"),
        )
        for metric_name, start_joint, end_joint in distance_pairs:
            if start_joint in joints and end_joint in joints:
                metrics[metric_name] = _distance_3d(joints[start_joint], joints[end_joint])

        return metrics

    def _compare_with_template(self, exercise: str, metrics: Dict[str, float]) -> str:
        if not metrics:
            return "Tracking body..."

        template = self._load_template(exercise)
        if not template:
            metric_order = (
                "arm_head_distance_m",
                "arm_head_quality",
                "left_arm_distance_m",
                "right_arm_distance_m",
                "left_leg_distance_m",
                "right_leg_distance_m",
                "left_arm_distance_velocity_mps",
                "right_arm_distance_velocity_mps",
                "left_leg_distance_velocity_mps",
                "right_leg_distance_velocity_mps",
                "left_knee_angle_deg",
                "right_knee_angle_deg",
                "left_hip_angle_deg",
                "right_hip_angle_deg",
                "left_elbow_angle_deg",
                "right_elbow_angle_deg",
                "torso_forward_offset_m",
                "shoulder_width_m",
                "hip_width_m",
                "stance_width_m",
            )
            parts = []
            for name in metric_order:
                value = metrics.get(name)
                if value is None:
                    continue
                if name.endswith("_deg"):
                    parts.append(f"{name}={value:.1f}deg")
                elif name.endswith("_m"):
                    parts.append(f"{name}={value:.3f}m")
                else:
                    parts.append(f"{name}={value:.3f}")
            return " | ".join(parts[:6]) if parts else "Tracking body..."

        range_map = template.get("targetRangesDeg") or template.get("target_ranges_deg") or {}
        if not isinstance(range_map, dict):
            return "Template format unsupported"

        issues = []
        for metric_name, metric_value in metrics.items():
            bounds = range_map.get(metric_name)
            if (
                not isinstance(bounds, (list, tuple))
                or len(bounds) != 2
                or not isinstance(bounds[0], (int, float))
                or not isinstance(bounds[1], (int, float))
            ):
                continue

            low, high = float(bounds[0]), float(bounds[1])
            if metric_value < low:
                issues.append(f"{metric_name} below target")
            elif metric_value > high:
                issues.append(f"{metric_name} above target")

        return "Good form" if not issues else "; ".join(issues)

    def _load_template(self, exercise: str) -> Optional[Dict[str, object]]:
        if exercise in self.templates_cache:
            return self.templates_cache[exercise]

        if self.templates_collection is None:
            self.templates_cache[exercise] = {}
            return None

        doc = self.templates_collection.find_one({"exercise": exercise})
        if not doc:
            self.templates_cache[exercise] = {}
            return None

        self.templates_cache[exercise] = doc
        return doc

    def _log_session(self, frame: SkeletonFrame, metrics: Dict[str, float], feedback: str) -> None:
        if self.sessions_collection is None:
            return
        if (self.frame_index % config.LOG_EVERY_N_FRAMES) != 0:
            return

        record = {
            "timestamp": frame.timestamp,
            "exercise": frame.exercise,
            "source": frame.source,
            "metrics": metrics,
            "feedback": feedback,
            "skeleton": to_pipeline_payload(frame),
        }
        self.sessions_collection.insert_one(record)


class MediaPipeFusionEngine:
    """
    Runs MediaPipe pose on iOS-streamed video frames and returns tracked joints.
    """

    def __init__(self) -> None:
        self.pose = None
        self.pose_landmarker = None
        self.landmarker_ts_ms = 0
        self.backend_name = "disabled"

        if hasattr(mp, "solutions") and hasattr(mp.solutions, "pose"):
            self.pose = mp.solutions.pose.Pose(
                static_image_mode=False,
                model_complexity=1,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self.backend_name = "solutions.pose"
            return

        if MP_TASKS_AVAILABLE:
            model_path = Path(config.MEDIAPIPE_POSE_TASK_MODEL).expanduser()
            if not model_path.is_absolute():
                model_path = (Path(__file__).resolve().parent / model_path).resolve()
            if not model_path.exists():
                raise RuntimeError(
                    f"MediaPipe task model not found: {model_path}. "
                    "Set MEDIAPIPE_POSE_TASK_MODEL to a valid .task file."
                )

            assert MPBaseOptions is not None
            assert MPPoseLandmarkerOptions is not None
            assert MPPoseLandmarker is not None
            assert MPRunningMode is not None

            options = MPPoseLandmarkerOptions(
                base_options=MPBaseOptions(model_asset_path=str(model_path)),
                running_mode=MPRunningMode.VIDEO,
                num_poses=1,
                min_pose_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self.pose_landmarker = MPPoseLandmarker.create_from_options(options)
            self.backend_name = "tasks.pose_landmarker"
            return

        raise RuntimeError(
            "MediaPipe pose backend unavailable. "
            "Neither mp.solutions.pose nor mediapipe.tasks PoseLandmarker is available."
        )

    def capture(self, frame_bgr: Optional[np.ndarray]) -> Optional[Dict[str, Dict[str, float]]]:
        if frame_bgr is None:
            return None

        landmarks = None
        if self.pose is not None:
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            result = self.pose.process(rgb)
            if not result or not result.pose_landmarks:
                return None
            landmarks = result.pose_landmarks.landmark
        elif self.pose_landmarker is not None:
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            self.landmarker_ts_ms += 1
            result = self.pose_landmarker.detect_for_video(mp_image, self.landmarker_ts_ms)
            if not result or not result.pose_landmarks:
                return None
            landmarks = result.pose_landmarks[0]
        else:
            return None

        joints: Dict[str, Dict[str, float]] = {}
        for joint_name, index in MEDIAPIPE_INDEX_BY_JOINT.items():
            if index >= len(landmarks):
                continue
            landmark = landmarks[index]
            visibility = getattr(landmark, "visibility", None)
            if visibility is None:
                visibility = getattr(landmark, "presence", 1.0)
            if visibility is None:
                visibility = 1.0
            joints[joint_name] = {
                "x": float(landmark.x),
                "y": float(landmark.y),
                "visibility": float(visibility),
            }
        return joints

    def close(self) -> None:
        if self.pose is not None:
            self.pose.close()
            self.pose = None
        if self.pose_landmarker is not None:
            self.pose_landmarker.close()
            self.pose_landmarker = None


def _fuse_ios_and_mediapipe(
    ios_frame: SkeletonFrame,
    mediapipe_joints: Mapping[str, Mapping[str, float]],
) -> SkeletonFrame:
    fused_keypoints = dict(ios_frame.keypoints_2d)
    lidar_depth_joints = set(ios_frame.point_depths_m.keys())

    for joint_name, mp_joint in mediapipe_joints.items():
        visibility = float(mp_joint.get("visibility", 0.0))
        if visibility < config.MEDIAPIPE_FUSION_VISIBILITY_MIN:
            continue

        # Keep LiDAR-projected keypoints authoritative wherever a valid depth sample exists.
        if joint_name in lidar_depth_joints:
            continue

        mp_x = float(mp_joint["x"])
        mp_y = float(mp_joint["y"])
        if joint_name not in fused_keypoints:
            fused_keypoints[joint_name] = (mp_x, mp_y)
            continue
        ios_x, ios_y = fused_keypoints[joint_name]
        delta = math.hypot(mp_x - ios_x, mp_y - ios_y)
        if delta > config.MEDIAPIPE_FUSION_MAX_JOINT_DELTA:
            continue
        alpha = config.MEDIAPIPE_FUSION_WEIGHT
        if config.MEDIAPIPE_FUSION_MAX_JOINT_DELTA > 1e-6:
            distance_weight = max(
                0.0,
                1.0 - (delta / config.MEDIAPIPE_FUSION_MAX_JOINT_DELTA),
            )
            alpha *= distance_weight
        if alpha <= 0.0:
            continue
        fused_keypoints[joint_name] = (
            ((1.0 - alpha) * ios_x) + (alpha * mp_x),
            ((1.0 - alpha) * ios_y) + (alpha * mp_y),
        )

    reconstructed_camera_points = reconstruct_camera_points_3d(
        keypoints_2d=fused_keypoints,
        point_depths_m=ios_frame.point_depths_m,
        camera_intrinsics=ios_frame.camera_intrinsics,
        camera_resolution=ios_frame.camera_resolution,
    )
    fused_camera_points_3d = dict(ios_frame.camera_points_3d)
    for joint_name, coords in reconstructed_camera_points.items():
        # Do not overwrite LiDAR-sourced camera points.
        if joint_name not in fused_camera_points_3d:
            fused_camera_points_3d[joint_name] = coords

    return replace(
        ios_frame,
        keypoints_2d=fused_keypoints,
        camera_points_3d=fused_camera_points_3d,
        source="ios_lidar+mediapipe",
    )


async def run_ios_stream_pipeline(pipeline: ExercisePipeline) -> None:
    ws_config = IOSWebSocketConfig(
        host=config.IOS_STREAM_HOST,
        port=config.IOS_STREAM_PORT,
        path=config.IOS_STREAM_PATH,
        scheme=config.IOS_STREAM_SCHEME,
        reconnect_delay_sec=config.IOS_STREAM_RECONNECT_DELAY_SEC,
    )
    remote_uri = build_websocket_uri(ws_config)
    if config.IOS_DEVICE_IS_SERVER and config.IOS_STREAM_HOST.strip().lower() in {"127.0.0.1", "localhost"}:
        print(
            "[iOS stream] IOS_STREAM_HOST is loopback. This only works with iOS Simulator "
            "or explicit port forwarding. For a physical iPhone, set IOS_STREAM_HOST "
            "to the phone's LAN IP address."
        )

    last_log_at = 0.0
    warned_missing_ios_video = False
    warned_missing_depth_samples = False
    consecutive_missing_video_frames = 0
    last_missing_video_warning_at = 0.0
    consecutive_no_depth_frames = 0
    no_depth_warmup_frames = 12
    warned_running_without_depth = False
    active_processing_task: Optional[asyncio.Task] = None
    dropped_payloads = 0
    last_drop_log_at = 0.0
    received_payloads = 0
    last_receive_log_at = 0.0
    last_payload_received_at = time.monotonic()
    last_stall_log_at = 0.0
    last_processed_at = 0.0
    frame_interval_sec = (1.0 / config.IOS_MAX_PROCESS_FPS) if config.IOS_MAX_PROCESS_FPS > 0.0 else 0.0
    rate_limited_count = 0
    last_rate_limit_log_at = 0.0
    mediapipe_fusion = None
    fusion_enabled = (
        config.ENABLE_MEDIAPIPE_FUSION
        and config.USE_IOS_VIDEO_FOR_MEDIAPIPE
        and config.IOS_ENABLE_VIDEO_FRAME_STREAM
    )
    if fusion_enabled:
        try:
            mediapipe_fusion = MediaPipeFusionEngine()
        except Exception as error:
            print(f"[iOS stream] MediaPipe fusion disabled: {error}")
            mediapipe_fusion = None
    elif config.ENABLE_MEDIAPIPE_FUSION:
        print(
            "[iOS stream] MediaPipe fusion requested but disabled because "
            "IOS_ENABLE_VIDEO_FRAME_STREAM and USE_IOS_VIDEO_FOR_MEDIAPIPE must both be true."
        )
    if mediapipe_fusion is not None:
        print(
            "[iOS stream] LiDAR + MediaPipe fusion enabled on iPhone video feed "
            f"(backend={mediapipe_fusion.backend_name}, "
            f"mp_weight={config.MEDIAPIPE_FUSION_WEIGHT:.2f}, "
            f"visibility_min={config.MEDIAPIPE_FUSION_VISIBILITY_MIN:.2f}, "
            f"max_joint_delta={config.MEDIAPIPE_FUSION_MAX_JOINT_DELTA:.2f})"
        )
    if frame_interval_sec > 0.0:
        print(
            f"[iOS stream] Processing throttle enabled: max {config.IOS_MAX_PROCESS_FPS:.1f} fps "
            f"(min interval {frame_interval_sec * 1000.0:.1f} ms)"
        )
    if not config.IOS_ENABLE_VIDEO_FRAME_STREAM:
        print("[iOS stream] Video decode disabled. Using LiDAR joint stream only.")
    if not config.IOS_INCLUDE_ALL_JOINTS:
        print("[iOS stream] Using MediaPipe-mapped LiDAR joints only (full all_joints disabled).")
    if config.IOS_DROP_PAYLOADS_IF_BUSY:
        print("[iOS stream] Overflow mode: drop incoming payloads while processing current frame")
    else:
        print("[iOS stream] Overflow mode: process every payload (may increase latency)")
    preview = (
        IOSSkeletonPreview(
            width=config.IOS_PREVIEW_WIDTH,
            height=config.IOS_PREVIEW_HEIGHT,
            show_joint_labels=config.IOS_PREVIEW_SHOW_LABELS,
            camera_source=config.CAMERA_SOURCE,
            overlay_on_camera=config.IOS_PREVIEW_OVERLAY_ON_CAMERA,
            show_mediapipe=config.IOS_PREVIEW_SHOW_MEDIAPIPE,
        )
        if config.SHOW_IOS_PREVIEW
        else None
    )

    async def process_payload(payload: Dict[str, object]) -> None:
        nonlocal last_log_at, preview, warned_missing_ios_video, warned_missing_depth_samples
        nonlocal consecutive_missing_video_frames, last_missing_video_warning_at
        nonlocal consecutive_no_depth_frames, warned_running_without_depth
        nonlocal last_processed_at, rate_limited_count, last_rate_limit_log_at
        now_perf = time.perf_counter()
        if frame_interval_sec > 0.0 and (now_perf - last_processed_at) < frame_interval_sec:
            rate_limited_count += 1
            if (now_perf - last_rate_limit_log_at) >= 2.0:
                last_rate_limit_log_at = now_perf
                print(
                    "[iOS stream] Throttle active. "
                    f"Skipped frames due to FPS cap: {rate_limited_count}"
                )
            return
        last_processed_at = now_perf

        try:
            frame = adapt_ios_payload(
                payload,
                decode_video_frame=config.IOS_ENABLE_VIDEO_FRAME_STREAM,
            )
        except ValueError as error:
            print(f"[iOS stream] Ignoring invalid payload: {error}")
            return

        depth_mode = (frame.depth_mode or "none").lower()
        depth_expected = depth_mode not in {"none", "body_only"}
        if not frame.point_depths_m:
            consecutive_no_depth_frames += 1
            if not warned_missing_depth_samples:
                warned_missing_depth_samples = True
                print(
                    "[iOS stream] Payload has no LiDAR point depths. "
                    f"depth_mode={depth_mode}"
                )
            if depth_expected and consecutive_no_depth_frames <= no_depth_warmup_frames:
                feedback = "Waiting for LiDAR depth points..."
                if preview is not None and not preview.render(
                    frame,
                    feedback,
                    {},
                    background_frame=frame.video_frame_bgr,
                    mediapipe_joints=None,
                ):
                    preview = None
                now = time.time()
                if now - last_log_at >= 0.5:
                    last_log_at = now
                    print(
                        f"[iOS stream] {frame.exercise} | depth_pts=0 | status=waiting_for_lidar_depth"
                    )
                return

            if depth_expected and not warned_running_without_depth:
                warned_running_without_depth = True
                print(
                    "[iOS stream] Continuing without LiDAR point depths after warmup. "
                    "Using pose/camera fallback distances."
                )
        else:
            consecutive_no_depth_frames = 0
            warned_missing_depth_samples = False
            warned_running_without_depth = False

        # Keep runtime lightweight by default: only retain the MediaPipe-mapped LiDAR joints.
        if frame.source.startswith("ios") and not config.IOS_INCLUDE_ALL_JOINTS:
            frame = replace(frame, all_joints_3d=dict(frame.joints_3d))

        mp_joints = None
        if mediapipe_fusion is not None:
            if frame.video_frame_bgr is None:
                consecutive_missing_video_frames += 1
                if config.WARN_IF_IOS_VIDEO_MISSING:
                    now_warn = time.monotonic()
                    if (
                        consecutive_missing_video_frames >= 3
                        and (now_warn - last_missing_video_warning_at) >= 2.0
                    ):
                        last_missing_video_warning_at = now_warn
                        warned_missing_ios_video = True
                        print(
                            "[iOS stream] Missing iPhone video frames in payload. "
                            f"consecutive_missing={consecutive_missing_video_frames}. "
                            "Distance metrics continue from LiDAR/camera pose."
                        )
            else:
                if warned_missing_ios_video and consecutive_missing_video_frames > 0:
                    print(
                        "[iOS stream] iPhone video stream resumed. "
                        f"previous_missing={consecutive_missing_video_frames}"
                    )
                warned_missing_ios_video = False
                consecutive_missing_video_frames = 0
                mp_joints = mediapipe_fusion.capture(frame.video_frame_bgr)

        if mp_joints is not None:
            frame = _fuse_ios_and_mediapipe(frame, mp_joints)

        feedback, metrics = pipeline.evaluate_frame(frame)
        if preview is not None and not preview.render(
            frame,
            feedback,
            metrics,
            background_frame=frame.video_frame_bgr,
            mediapipe_joints=mp_joints,
        ):
            preview = None
        now = time.time()
        if now - last_log_at >= 0.5:
            last_log_at = now
            arm_parts = []
            left_arm_distance = metrics.get("left_arm_distance_m")
            right_arm_distance = metrics.get("right_arm_distance_m")
            left_leg_distance = metrics.get("left_leg_distance_m")
            right_leg_distance = metrics.get("right_leg_distance_m")
            arm_head_distance = metrics.get("arm_head_distance_m")
            arm_head_quality = metrics.get("arm_head_quality")
            if left_arm_distance is not None:
                arm_parts.append(f"L_arm_dist={float(left_arm_distance):.3f}m")
            if right_arm_distance is not None:
                arm_parts.append(f"R_arm_dist={float(right_arm_distance):.3f}m")
            if left_leg_distance is not None:
                arm_parts.append(f"L_leg_dist={float(left_leg_distance):.3f}m")
            if right_leg_distance is not None:
                arm_parts.append(f"R_leg_dist={float(right_leg_distance):.3f}m")
            if arm_head_distance is not None:
                arm_parts.append(f"arm_head={float(arm_head_distance):.3f}m")
            if frame.arm_head_state is not None:
                arm_parts.append(f"arm_head_state={frame.arm_head_state}")
            if arm_head_quality is not None:
                arm_parts.append(f"arm_head_q={float(arm_head_quality):.2f}")
            if frame.arm_head_source is not None:
                arm_parts.append(f"arm_head_src={frame.arm_head_source}")
            joint_distance_parts = []
            for metric_name in sorted(metrics.keys()):
                if not metric_name.endswith("_distance_m"):
                    continue
                if metric_name in {"left_arm_distance_m", "right_arm_distance_m", "arm_head_distance_m"}:
                    continue
                value = metrics.get(metric_name)
                if value is None:
                    continue
                joint_distance_parts.append(f"{metric_name}={float(value):.3f}m")
            if joint_distance_parts:
                preview_count = 8
                distance_preview = ", ".join(joint_distance_parts[:preview_count])
                if len(joint_distance_parts) > preview_count:
                    distance_preview += f", +{len(joint_distance_parts) - preview_count} more"
                arm_parts.append(f"joint_distances[{len(joint_distance_parts)}]={distance_preview}")
            if not arm_parts:
                arm_parts.append("arm_distance=NA")
            print(
                f"[iOS stream] {frame.exercise} | depth_pts={len(frame.point_depths_m)} | "
                + " | ".join(arm_parts)
                + f" | {feedback}"
            )

    async def on_payload(payload: Dict[str, object]) -> None:
        nonlocal active_processing_task, dropped_payloads, last_drop_log_at, last_payload_received_at
        nonlocal received_payloads, last_receive_log_at
        last_payload_received_at = time.monotonic()
        received_payloads += 1
        now = time.time()
        if (now - last_receive_log_at) >= 2.0:
            last_receive_log_at = now
            print(f"[iOS stream] Incoming payloads: {received_payloads}")
        if config.IOS_DROP_PAYLOADS_IF_BUSY:
            if active_processing_task is not None and not active_processing_task.done():
                dropped_payloads += 1
                if (now - last_drop_log_at) >= 2.0:
                    last_drop_log_at = now
                    print(
                        "[iOS stream] Dropping incoming frames while busy. "
                        f"dropped={dropped_payloads}"
                    )
                return
            active_processing_task = asyncio.create_task(process_payload(payload))
            return

        await process_payload(payload)

    async def stream_health_monitor() -> None:
        nonlocal last_stall_log_at
        while True:
            await asyncio.sleep(1.0)
            idle_sec = time.monotonic() - last_payload_received_at
            if idle_sec < 3.0:
                continue
            now = time.monotonic()
            if (now - last_stall_log_at) < 3.0:
                continue
            last_stall_log_at = now
            print(
                "[iOS stream] No payloads for "
                f"{idle_sec:.1f}s. Check phone connection/path and IOS_STREAM_HOST."
            )

    monitor_task = asyncio.create_task(stream_health_monitor())
    try:
        try:
            if config.IOS_DEVICE_IS_SERVER:
                print(
                    f"[iOS stream] client mode: connecting to phone at {remote_uri}"
                )
                await consume_remote_skeleton_stream(ws_config, on_payload)
            else:
                print(
                    f"[iOS stream] server mode: listening on ws://{config.IOS_STREAM_HOST}:{config.IOS_STREAM_PORT}{config.IOS_STREAM_PATH}"
                )
                await run_skeleton_ws_server(ws_config, on_payload)
        finally:
            monitor_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await monitor_task
            if active_processing_task is not None:
                with contextlib.suppress(asyncio.CancelledError):
                    await active_processing_task
    finally:
        if mediapipe_fusion is not None:
            mediapipe_fusion.close()
        if preview is not None:
            preview.close()


def run_webcam_pipeline(pipeline: ExercisePipeline) -> None:
    if not (hasattr(mp, "solutions") and hasattr(mp.solutions, "pose")):
        raise RuntimeError(
            "Webcam mode requires mediapipe.solutions.pose, which is unavailable in this environment. "
            "Use USE_IOS_STREAM=true or install a compatible MediaPipe/Numpy stack."
        )
    cap = cv2.VideoCapture(config.CAMERA_SOURCE)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open camera source: {config.CAMERA_SOURCE}")

    mp_pose = mp.solutions.pose
    mp_draw = mp.solutions.drawing_utils

    with mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose:
        while cap.isOpened():
            ok, frame = cap.read()
            if not ok:
                break

            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(rgb)

            feedback = "No person detected"
            if results.pose_landmarks:
                skeleton = adapt_mediapipe_pose_landmarks(
                    results.pose_landmarks.landmark,
                    timestamp=time.time(),
                    exercise=config.DEFAULT_EXERCISE,
                )
                feedback = pipeline.process_frame(skeleton)
                mp_draw.draw_landmarks(
                    frame,
                    results.pose_landmarks,
                    mp_pose.POSE_CONNECTIONS,
                )

            if config.SHOW_CAMERA_PREVIEW:
                cv2.putText(
                    frame,
                    feedback,
                    (12, 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.65,
                    (40, 220, 120),
                    2,
                )
                cv2.putText(
                    frame,
                    "Press Q to quit",
                    (12, 56),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (220, 220, 220),
                    1,
                )
                cv2.imshow("GatorMotion - Webcam", frame)

                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break

    cap.release()
    cv2.destroyAllWindows()


def main() -> None:
    pipeline = ExercisePipeline()
    if config.USE_IOS_STREAM:
        asyncio.run(run_ios_stream_pipeline(pipeline))
    else:
        run_webcam_pipeline(pipeline)


if __name__ == "__main__":
    main()
