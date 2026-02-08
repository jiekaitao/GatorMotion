from __future__ import annotations

from typing import Dict, List, Mapping, Optional, Tuple, Union

import cv2
import numpy as np

from backend.skeleton_adapter import MEDIAPIPE_INDEX_BY_JOINT, SkeletonFrame

try:
    import mediapipe as mp
except Exception:  # pragma: no cover - optional at runtime
    mp = None

SKELETON_CONNECTIONS: Tuple[Tuple[str, str], ...] = (
    ("left_shoulder", "right_shoulder"),
    ("left_shoulder", "left_elbow"),
    ("left_elbow", "left_wrist"),
    ("right_shoulder", "right_elbow"),
    ("right_elbow", "right_wrist"),
    ("left_shoulder", "left_hip"),
    ("right_shoulder", "right_hip"),
    ("left_hip", "right_hip"),
    ("left_hip", "left_knee"),
    ("left_knee", "left_ankle"),
    ("right_hip", "right_knee"),
    ("right_knee", "right_ankle"),
)

DEPTH_JOINT_ORDER: Tuple[str, ...] = (
    "root",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
)

DISTANCE_METRIC_ORDER: Tuple[Tuple[str, str], ...] = (
    ("arm_head_distance_m", "Arm-head dist"),
    ("left_upper_arm_length_m", "L upper arm"),
    ("right_upper_arm_length_m", "R upper arm"),
    ("left_forearm_length_m", "L forearm"),
    ("right_forearm_length_m", "R forearm"),
    ("left_thigh_length_m", "L thigh"),
    ("right_thigh_length_m", "R thigh"),
    ("left_shin_length_m", "L shin"),
    ("right_shin_length_m", "R shin"),
    ("left_side_body_length_m", "L torso side"),
    ("right_side_body_length_m", "R torso side"),
    ("shoulder_width_m", "Shoulder width"),
    ("hip_width_m", "Hip width"),
    ("stance_width_m", "Stance width"),
)


class IOSSkeletonPreview:
    def __init__(
        self,
        width: int = 960,
        height: int = 720,
        show_joint_labels: bool = True,
        window_name: str = "GatorMotion - iOS + MediaPipe Overlay",
        camera_source: Union[int, str] = 0,
        overlay_on_camera: bool = True,
        show_mediapipe: bool = True,
    ) -> None:
        self.width = max(width, 320)
        self.height = max(height, 240)
        self.show_joint_labels = show_joint_labels
        self.window_name = window_name
        self.camera_source = camera_source
        self.overlay_on_camera = overlay_on_camera
        self.show_mediapipe = show_mediapipe and mp is not None
        self.enabled = True

        self._camera: Optional[cv2.VideoCapture] = None
        self._pose_estimator = None
        self._drawing_utils = None
        self._pose_connections = None

    def _ensure_camera(self) -> Optional[cv2.VideoCapture]:
        if not self.overlay_on_camera:
            return None
        if self._camera is None:
            camera = cv2.VideoCapture(self.camera_source)
            camera.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
            camera.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
            if not camera.isOpened():
                print(
                    f"[Preview] Camera source {self.camera_source} unavailable. Falling back to blank canvas."
                )
                camera.release()
                self.overlay_on_camera = False
                return None
            self._camera = camera
        return self._camera

    def _ensure_pose_estimator(self):
        if not self.show_mediapipe:
            return None
        if not hasattr(mp, "solutions") or not hasattr(mp.solutions, "pose"):
            print("[Preview] mediapipe.solutions.pose unavailable. Camera-side MP drawing disabled.")
            self.show_mediapipe = False
            return None
        if self._pose_estimator is None:
            self._pose_estimator = mp.solutions.pose.Pose(
                static_image_mode=False,
                model_complexity=1,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self._drawing_utils = mp.solutions.drawing_utils
            self._pose_connections = mp.solutions.pose.POSE_CONNECTIONS
        return self._pose_estimator

    @staticmethod
    def _dimensions_m(frame: SkeletonFrame) -> Tuple[float, float, float]:
        if not frame.joints_3d:
            return 0.0, 0.0, 0.0

        xs = [coord[0] for coord in frame.joints_3d.values()]
        ys = [coord[1] for coord in frame.joints_3d.values()]
        zs = [coord[2] for coord in frame.joints_3d.values()]
        width_m = max(xs) - min(xs)
        height_m = max(ys) - min(ys)
        depth_m = max(zs) - min(zs)
        return width_m, height_m, depth_m

    @staticmethod
    def _extract_mediapipe_bbox(pose_result) -> Optional[Tuple[float, float, float, float]]:
        if pose_result is None or not getattr(pose_result, "pose_landmarks", None):
            return None

        x_values = []
        y_values = []
        for index in MEDIAPIPE_INDEX_BY_JOINT.values():
            if index >= len(pose_result.pose_landmarks.landmark):
                continue
            landmark = pose_result.pose_landmarks.landmark[index]
            visibility = float(getattr(landmark, "visibility", 1.0))
            if visibility < 0.3:
                continue
            x_values.append(float(landmark.x))
            y_values.append(float(landmark.y))

        if len(x_values) < 4 or len(y_values) < 4:
            return None

        min_x = max(0.0, min(x_values))
        max_x = min(1.0, max(x_values))
        min_y = max(0.0, min(y_values))
        max_y = min(1.0, max(y_values))

        if (max_x - min_x) < 1e-4 or (max_y - min_y) < 1e-4:
            return None

        return min_x, min_y, max_x, max_y

    @staticmethod
    def _extract_bbox_from_mediapipe_joints(
        mediapipe_joints: Mapping[str, Mapping[str, float]],
    ) -> Optional[Tuple[float, float, float, float]]:
        if not mediapipe_joints:
            return None

        x_values = []
        y_values = []
        for joint in mediapipe_joints.values():
            visibility = float(joint.get("visibility", 0.0))
            if visibility < 0.3:
                continue
            x_values.append(float(joint.get("x", 0.0)))
            y_values.append(float(joint.get("y", 0.0)))

        if len(x_values) < 4 or len(y_values) < 4:
            return None

        min_x = max(0.0, min(x_values))
        max_x = min(1.0, max(x_values))
        min_y = max(0.0, min(y_values))
        max_y = min(1.0, max(y_values))
        if (max_x - min_x) < 1e-4 or (max_y - min_y) < 1e-4:
            return None
        return min_x, min_y, max_x, max_y

    @staticmethod
    def _map_onto_bbox(
        ios_points: Mapping[str, Tuple[float, float]],
        target_bbox: Tuple[float, float, float, float],
    ) -> Dict[str, Tuple[float, float]]:
        if not ios_points:
            return {}

        xs = [p[0] for p in ios_points.values()]
        ys = [p[1] for p in ios_points.values()]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        width = max(max_x - min_x, 1e-6)
        height = max(max_y - min_y, 1e-6)

        t_min_x, t_min_y, t_max_x, t_max_y = target_bbox
        t_width = max(t_max_x - t_min_x, 1e-6)
        t_height = max(t_max_y - t_min_y, 1e-6)

        mapped: Dict[str, Tuple[float, float]] = {}
        for name, (x, y) in ios_points.items():
            rel_x = (x - min_x) / width
            rel_y = (y - min_y) / height
            mapped[name] = (
                t_min_x + (rel_x * t_width),
                t_min_y + (rel_y * t_height),
            )
        return mapped

    @staticmethod
    def _to_pixel(normalized: Tuple[float, float], width: int, height: int) -> Tuple[int, int]:
        x = max(0.0, min(1.0, float(normalized[0])))
        y = max(0.0, min(1.0, float(normalized[1])))
        return int(x * (width - 1)), int(y * (height - 1))

    @staticmethod
    def _format_metric(metric_name: str, metric_value: float) -> str:
        if metric_name.endswith("_deg"):
            return f"{metric_name}: {metric_value:.1f} deg"
        if metric_name.endswith("_m"):
            return f"{metric_name}: {metric_value:.3f} m"
        return f"{metric_name}: {metric_value:.3f}"

    @staticmethod
    def _joint_label(joint_name: str) -> str:
        return joint_name.replace("_", " ").title()

    def _build_distance_lines(self, metrics: Mapping[str, float]) -> List[str]:
        lines: List[str] = []
        for metric_name, label in DISTANCE_METRIC_ORDER:
            value = metrics.get(metric_name)
            if value is None:
                continue
            lines.append(f"{label}: {float(value):.3f} m")
        return lines

    def _build_depth_lines(self, frame: SkeletonFrame) -> List[str]:
        lines: List[str] = []
        for joint_name in DEPTH_JOINT_ORDER:
            depth_m = frame.point_depths_m.get(joint_name)
            if depth_m is None:
                continue
            lines.append(f"{self._joint_label(joint_name)} depth: {float(depth_m):.3f} m")
        return lines

    @staticmethod
    def _direction_label(direction_value: float) -> str:
        if direction_value > 0.0:
            return "moving away"
        if direction_value < 0.0:
            return "moving closer"
        return "steady"

    def _build_motion_lines(self, metrics: Mapping[str, float]) -> List[str]:
        lines: List[str] = []
        for side, label in (("left", "L"), ("right", "R")):
            distance_m = metrics.get(f"{side}_arm_distance_m")
            if distance_m is None:
                distance_m = metrics.get(f"{side}_arm_rel_depth_m")
            velocity = metrics.get(f"{side}_arm_distance_velocity_mps")
            if velocity is None:
                velocity = metrics.get(f"{side}_arm_depth_velocity_mps")
            cycles = int(metrics.get(f"{side}_arm_back_forth_count", 0.0))
            direction = metrics.get(f"{side}_arm_distance_direction")
            if direction is None:
                direction = metrics.get(f"{side}_arm_depth_direction", 0.0)
            if distance_m is None and velocity is None and cycles == 0:
                continue

            rel_text = f"dist={float(distance_m):.3f}m" if distance_m is not None else "dist=--"
            vel_text = f"vel={float(velocity):+.3f}m/s" if velocity is not None else "vel=--"
            direction_text = self._direction_label(float(direction))
            lines.append(
                f"{label} arm: {rel_text} {vel_text} cycles={cycles} ({direction_text})"
            )
        return lines

    def _draw_header(
        self,
        frame_img: np.ndarray,
        frame: SkeletonFrame,
        feedback: str,
        metrics: Mapping[str, float],
    ) -> None:
        width_m, height_m, depth_m = self._dimensions_m(frame)
        distance_lines = self._build_distance_lines(metrics)
        depth_lines = self._build_depth_lines(frame)
        motion_lines = self._build_motion_lines(metrics)
        stats_lines: List[Tuple[str, Tuple[int, int, int]]] = []
        if motion_lines:
            stats_lines.append(("Arm motion:", (180, 235, 255)))
            stats_lines.extend((line, (255, 220, 160)) for line in motion_lines)
        if distance_lines:
            stats_lines.append(("Distances:", (180, 235, 255)))
            stats_lines.extend((line, (210, 235, 210)) for line in distance_lines)
        if depth_lines:
            stats_lines.append(("Depths:", (180, 235, 255)))
            stats_lines.extend((line, (170, 235, 255)) for line in depth_lines)
        if not stats_lines:
            stats_lines.append(("No per-part distance/depth available yet", (200, 200, 200)))

        line_height = 17
        panel_h = 96 + (len(stats_lines) * line_height)
        panel_h = min(panel_h, frame_img.shape[0] - 12)
        max_stats_lines = max((panel_h - 98) // line_height, 0)
        visible_stats = stats_lines[:max_stats_lines]

        overlay = frame_img.copy()
        cv2.rectangle(overlay, (8, 8), (frame_img.shape[1] - 8, panel_h), (8, 8, 8), -1)
        cv2.addWeighted(overlay, 0.52, frame_img, 0.48, 0, frame_img)

        cv2.putText(
            frame_img,
            (
                f"{frame.exercise} | Source: {frame.source} | MP + iOS overlay | "
                f"joints={len(frame.all_joints_3d)} | video={frame.video_width or 0}x{frame.video_height or 0}"
            ),
            (16, 32),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.64,
            (225, 225, 225),
            2,
        )
        cv2.putText(
            frame_img,
            f"Dimensions (m): W={width_m:.2f}  H={height_m:.2f}  D={depth_m:.2f}",
            (16, 58),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.58,
            (125, 230, 170),
            2,
        )
        cv2.putText(
            frame_img,
            f"Feedback: {feedback}",
            (16, 82),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52,
            (140, 220, 255),
            1,
        )

        for idx, (stat_line, color) in enumerate(visible_stats):
            y = 104 + (idx * line_height)
            if y >= panel_h - 8:
                break
            cv2.putText(
                frame_img,
                stat_line,
                (16, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.48,
                color,
                1,
            )

    def _get_background_frame(self) -> Tuple[np.ndarray, Optional[Tuple[float, float, float, float]]]:
        camera = self._ensure_camera()

        if camera is None:
            frame_img = np.zeros((self.height, self.width, 3), dtype=np.uint8)
            return frame_img, None

        ok, frame_img = camera.read()
        if not ok:
            frame_img = np.zeros((self.height, self.width, 3), dtype=np.uint8)
            return frame_img, None

        frame_img = cv2.flip(frame_img, 1)
        pose_bbox = None

        pose_estimator = self._ensure_pose_estimator()
        if pose_estimator is not None:
            rgb = cv2.cvtColor(frame_img, cv2.COLOR_BGR2RGB)
            pose_result = pose_estimator.process(rgb)
            pose_bbox = self._extract_mediapipe_bbox(pose_result)
            if pose_result and getattr(pose_result, "pose_landmarks", None):
                self._drawing_utils.draw_landmarks(
                    frame_img,
                    pose_result.pose_landmarks,
                    self._pose_connections,
                )

        return frame_img, pose_bbox

    def _draw_mediapipe_from_joints(
        self,
        frame_img: np.ndarray,
        mediapipe_joints: Mapping[str, Mapping[str, float]],
    ) -> None:
        if not mediapipe_joints:
            return

        canvas_h, canvas_w = frame_img.shape[:2]
        points_px: Dict[str, Tuple[int, int]] = {}
        for joint_name, values in mediapipe_joints.items():
            points_px[joint_name] = self._to_pixel(
                (float(values.get("x", 0.0)), float(values.get("y", 0.0))),
                canvas_w,
                canvas_h,
            )

        for start_joint, end_joint in SKELETON_CONNECTIONS:
            if start_joint in points_px and end_joint in points_px:
                cv2.line(
                    frame_img,
                    points_px[start_joint],
                    points_px[end_joint],
                    (70, 225, 70),
                    2,
                )

        for point in points_px.values():
            cv2.circle(frame_img, point, 4, (85, 240, 85), -1)

    def render(
        self,
        frame: SkeletonFrame,
        feedback: str,
        metrics: Optional[Mapping[str, float]] = None,
        background_frame: Optional[np.ndarray] = None,
        mediapipe_joints: Optional[Mapping[str, Mapping[str, float]]] = None,
    ) -> bool:
        if not self.enabled:
            return False

        if background_frame is not None:
            frame_img = cv2.resize(background_frame, (self.width, self.height))
            target_bbox = self._extract_bbox_from_mediapipe_joints(mediapipe_joints or {})
            if self.show_mediapipe and mediapipe_joints:
                self._draw_mediapipe_from_joints(frame_img, mediapipe_joints)
        else:
            frame_img, target_bbox = self._get_background_frame()
        canvas_h, canvas_w = frame_img.shape[:2]

        ios_points = dict(frame.keypoints_2d)
        if target_bbox is not None:
            ios_points = self._map_onto_bbox(ios_points, target_bbox)

        points_px: Dict[str, Tuple[int, int]] = {
            joint_name: self._to_pixel(coords, canvas_w, canvas_h)
            for joint_name, coords in ios_points.items()
        }

        for start_joint, end_joint in SKELETON_CONNECTIONS:
            if start_joint in points_px and end_joint in points_px:
                cv2.line(
                    frame_img,
                    points_px[start_joint],
                    points_px[end_joint],
                    (30, 90, 255),
                    3,
                )

        for joint_name, point in points_px.items():
            cv2.circle(frame_img, point, 6, (255, 215, 80), -1)
            if self.show_joint_labels:
                cv2.putText(
                    frame_img,
                    joint_name,
                    (point[0] + 7, point[1] - 8),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.38,
                    (230, 230, 230),
                    1,
                )

        self._draw_header(frame_img, frame, feedback, metrics or {})

        cv2.putText(
            frame_img,
            "Orange = iOS LiDAR overlay | Green = MediaPipe (phone feed) | Q hides preview",
            (14, canvas_h - 14),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.50,
            (200, 200, 200),
            1,
        )

        try:
            cv2.imshow(self.window_name, frame_img)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                self.close()
                return False
        except cv2.error as error:
            print(f"[Preview] Disabled: {error}")
            self.close()
            return False

        return True

    def close(self) -> None:
        if not self.enabled:
            return

        self.enabled = False
        try:
            cv2.destroyWindow(self.window_name)
        except cv2.error:
            pass

        if self._camera is not None:
            self._camera.release()
            self._camera = None

        if self._pose_estimator is not None:
            self._pose_estimator.close()
            self._pose_estimator = None
