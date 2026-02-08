"""
Real-time full body tracking with MediaPipe Tasks API.
Tracks: Pose (33 landmarks), Hands (21 each), Face Mesh (478 landmarks)
Press 'q' to quit.
"""

import cv2
import mediapipe as mp
import time
import os
import math
import numpy as np
from dataclasses import dataclass
from typing import Optional, Tuple, List

from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    PoseLandmarker, PoseLandmarkerOptions,
    HandLandmarker, HandLandmarkerOptions,
    FaceLandmarker, FaceLandmarkerOptions,
    PoseLandmarksConnections, HandLandmarksConnections, FaceLandmarksConnections,
    RunningMode,
    drawing_utils, drawing_styles,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Model paths ──
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")
POSE_MODEL = os.path.join(MODELS_DIR, "pose_landmarker_heavy.task")
HAND_MODEL = os.path.join(MODELS_DIR, "hand_landmarker.task")
FACE_MODEL = os.path.join(MODELS_DIR, "face_landmarker.task")

# ── Pose landmark labels (key body parts) ──
POSE_LABELS = {
    0: "nose",
    7: "L ear", 8: "R ear",
    11: "L shoulder", 12: "R shoulder",
    13: "L elbow", 14: "R elbow",
    15: "L wrist", 16: "R wrist",
    23: "L hip", 24: "R hip",
    25: "L knee", 26: "R knee",
    27: "L ankle", 28: "R ankle",
}

# ── Results storage (updated by callbacks) ──
latest_pose = None
latest_hands = None
latest_face = None
frame_ts = 0


def pose_callback(result, image, timestamp_ms):
    global latest_pose
    latest_pose = result


def hand_callback(result, image, timestamp_ms):
    global latest_hands
    latest_hands = result


def face_callback(result, image, timestamp_ms):
    global latest_face
    latest_face = result


# ══════════════════════════════════════════════════════════════════════════════
# PORTED FROM nmp_simulink: Complementary Filter & PI Controller
# ══════════════════════════════════════════════════════════════════════════════

class ComplementaryFilter:
    def __init__(self, alpha: float = 0.85):
        self.alpha = alpha
        self.smoothed_value = None
        self.last_time = None
    
    def update(self, raw_value: float, velocity: float = 0.0) -> float:
        current_time = time.time()
        if self.smoothed_value is None:
            self.smoothed_value = raw_value
            self.last_time = current_time
            return raw_value
        dt = current_time - self.last_time
        if dt <= 0 or dt > 0.5: dt = 0.033
        self.last_time = current_time
        self.smoothed_value = (self.alpha * (self.smoothed_value + velocity * dt) + (1 - self.alpha) * raw_value)
        return self.smoothed_value
    
    def reset(self):
        self.smoothed_value = None
        self.last_time = None

class PIController:
    def __init__(self, kp: float = 1.0, ki: float = 1.0, ts: float = 0.2):
        self.kp = kp; self.ki = ki; self.ts = ts
        self.integrator_state = 0.0; self.last_update_time = None
    
    def update(self, error: float) -> float:
        current_time = time.time()
        if self.last_update_time is None: self.last_update_time = current_time
        dt = current_time - self.last_update_time
        if dt >= self.ts:
            self.integrator_state += self.ts * error * self.ki
            self.last_update_time = current_time
        return (self.kp * error + self.integrator_state)
    
    def reset(self):
        self.integrator_state = 0.0; self.last_update_time = None

def calculate_angle(a, b, c) -> float:
    ba = (a[0] - b[0], a[1] - b[1])
    bc = (c[0] - b[0], c[1] - b[1])
    dot_product = ba[0] * bc[0] + ba[1] * bc[1]
    magnitude_ba = math.sqrt(ba[0]**2 + ba[1]**2)
    magnitude_bc = math.sqrt(bc[0]**2 + bc[1]**2)
    if magnitude_ba * magnitude_bc == 0: return 0.0
    cos_angle = max(-1.0, min(1.0, dot_product / (magnitude_ba * magnitude_bc)))
    return math.degrees(math.acos(cos_angle))

@dataclass
class ExerciseConfig:
    name: str
    joint_indices: Tuple[int, int, int]
    start_angle: float
    peak_angle: float
    threshold: float = 15.0
    rest_threshold: float = 35.0

class RepCounter:
    EXERCISES = {
        "arm_abduction": ExerciseConfig("Arm Abduction", (24, 12, 14), 0, 140, threshold=20),
        "arm_vw": ExerciseConfig("Arm VW", (24, 12, 14), 30, 165, threshold=25, rest_threshold=40),
        "squat": ExerciseConfig("Squat", (12, 24, 26), 175, 145, threshold=15, rest_threshold=18),
        "leg_abduction": ExerciseConfig("Leg Abduction", (11, 23, 25), 172, 140, threshold=15, rest_threshold=15),
    }
    
    def __init__(self, exercise_key: str = "arm_abduction"):
        self.config = self.EXERCISES.get(exercise_key, self.EXERCISES["arm_abduction"])
        self.filter = ComplementaryFilter(alpha=0.85)
        self.controller = PIController(kp=1.0, ki=0.5, ts=0.1)
        self.rep_count = 0; self.state = "rest"; self.current_angle = 0.0; self.smoothed_angle = 0.0; self.form_quality = "neutral"
    
    def update(self, landmarks, frame_width, frame_height):
        if not landmarks: return self._get_status()
        a, b, c = [landmarks[i] for i in self.config.joint_indices]
        if min(a.visibility, b.visibility, c.visibility) < 0.5: return self._get_status()
        
        raw_angle = calculate_angle((a.x*frame_width, a.y*frame_height), (b.x*frame_width, b.y*frame_height), (c.x*frame_width, c.y*frame_height))
        self.current_angle = raw_angle
        self.smoothed_angle = self.filter.update(raw_angle)
        
        # State Machine
        target = self.config.peak_angle if self.state in ["moving", "peak"] else self.config.start_angle
        self.controller.update(target - self.smoothed_angle)
        
        up = self.config.peak_angle > self.config.start_angle
        at_peak = self.smoothed_angle > (self.config.peak_angle - self.config.threshold) if up else self.smoothed_angle < (self.config.peak_angle + self.config.threshold)
        at_rest = self.smoothed_angle < (self.config.start_angle + self.config.rest_threshold) if up else self.smoothed_angle > (self.config.start_angle - self.config.rest_threshold)
        
        if self.state == "rest" and not at_rest: self.state = "moving"
        elif self.state == "moving" and at_peak: self.state = "peak"
        elif self.state == "peak" and not at_peak: self.state = "returning"
        elif self.state == "returning" and at_rest: 
            self.state = "rest"; self.rep_count += 1; self.controller.reset()
            
        # Form Check
        self.form_quality = "warning" if (self.smoothed_angle > 170 or self.smoothed_angle < 10) else ("good" if self.state == "peak" else "neutral")
        return self._get_status()

    def _get_status(self):
        return {"rep_count": self.rep_count, "angle": self.smoothed_angle, "state": self.state, "form_quality": self.form_quality, "name": self.config.name}
    
    def reset(self):
        self.rep_count = 0; self.state = "rest"; self.filter.reset(); self.controller.reset()


# ══════════════════════════════════════════════════════════════════════════════
# PAIN DETECTOR (Facial Expression Analysis)
# ══════════════════════════════════════════════════════════════════════════════
class PainDetector:
    def __init__(self):
        self.pain_level = "normal"  # normal, warning, stop
        self.message = ""
        # Thresholds (Tuned for "Lower" sensitivity)
        # Thresholds (Eyes slightly less sensitive)
        # Eye Aspect Ratio (EAR): < 0.20 is warning, < 0.15 is stop
        self.EAR_WARNING = 0.20
        self.EAR_STOP = 0.15
        # Mouth Aspect Ratio (MAR): > 0.50 is warning, > 0.75 is stop
        self.MAR_WARNING = 0.50
        self.MAR_STOP = 0.75
        
        # Brows? (Maybe later)
    
    def update(self, face_landmarks, w, h):
        if not face_landmarks: return "normal", ""
        
        # Helper to get dist
        def dist(i1, i2):
            p1 = face_landmarks[i1]; p2 = face_landmarks[i2]
            return math.hypot((p1.x - p2.x)*w, (p1.y - p2.y)*h)
            
        # Left Eye (33, 133, 159, 145) -> (inner, outer, top, bottom)
        # Right Eye (362, 263, 386, 374)
        ear_l = dist(159, 145) / (dist(33, 133) + 1e-6)
        ear_r = dist(386, 374) / (dist(362, 263) + 1e-6)
        ear = (ear_l + ear_r) / 2.0
        
        # Mouth (13, 14, 78, 308) -> (top, bottom, left, right)
        mar = dist(13, 14) / (dist(78, 308) + 1e-6)
        
        # Logic — require BOTH eyes and mouth to flag (no single-indicator triggers)
        if ear < self.EAR_STOP and mar > self.MAR_STOP:
            self.pain_level = "stop"
            self.message = "STOP! HIGH PAIN DETECTED"
        elif ear < self.EAR_WARNING and mar > self.MAR_WARNING:
            self.pain_level = "warning"
            self.message = "Warning: Facial Strain Detected"
        else:
            self.pain_level = "normal"
            self.message = ""
            
        return self.pain_level, self.message, ear, mar


# ── Create landmarkers (LIVE_STREAM for async processing) ──
pose_landmarker = PoseLandmarker.create_from_options(
    PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=POSE_MODEL),
        running_mode=RunningMode.LIVE_STREAM,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5,
        result_callback=pose_callback,
    )
)

hand_landmarker = HandLandmarker.create_from_options(
    HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=HAND_MODEL),
        running_mode=RunningMode.LIVE_STREAM,
        num_hands=2,
        min_hand_detection_confidence=0.5,
        min_tracking_confidence=0.5,
        result_callback=hand_callback,
    )
)

face_landmarker = FaceLandmarker.create_from_options(
    FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=FACE_MODEL),
        running_mode=RunningMode.LIVE_STREAM,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_tracking_confidence=0.5,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
        result_callback=face_callback,
    )
)

# ── Webcam ──
rep_counter = RepCounter("shoulder_raise")
pain_detector = PainDetector()
cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

if not cap.isOpened():
    print("ERROR: Cannot open camera")
    exit(1)

print("Camera opened. Press 'q' to quit.")
prev_time = time.time()

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    frame = cv2.flip(frame, 1)
    h, w, _ = frame.shape
    frame_ts += 1

    # Convert to MediaPipe Image
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    # Send to all three landmarkers asynchronously
    pose_landmarker.detect_async(mp_image, frame_ts)
    hand_landmarker.detect_async(mp_image, frame_ts)
    face_landmarker.detect_async(mp_image, frame_ts)

    # ── Draw Face Mesh ──
    if latest_face and latest_face.face_landmarks:
        for face_lms in latest_face.face_landmarks:
            drawing_utils.draw_landmarks(
                frame, face_lms,
                FaceLandmarksConnections.FACE_LANDMARKS_TESSELATION,
                None,
                drawing_styles.get_default_face_mesh_tesselation_style(),
            )
            drawing_utils.draw_landmarks(
                frame, face_lms,
                FaceLandmarksConnections.FACE_LANDMARKS_CONTOURS,
                None,
                drawing_styles.get_default_face_mesh_contours_style(),
            )

    
    # ── Pain Detection ──
    pain_status = ("normal", "", 0, 0)
    if latest_face and latest_face.face_landmarks:
        for face_lms in latest_face.face_landmarks:
             pain_status = pain_detector.update(face_lms, w, h)

    # ── Draw Pose ──
    if latest_pose and latest_pose.pose_landmarks:
        # Initialize status for UI
        status = {"rep_count": rep_counter.rep_count, "angle": 0, "state": "waiting", "form_quality": "neutral", "name": "PT Tracker"}
        
        for pose_lms in latest_pose.pose_landmarks:
            status = rep_counter.update(pose_lms, w, h)
            drawing_utils.draw_landmarks(
                frame, pose_lms,
                PoseLandmarksConnections.POSE_LANDMARKS,
                drawing_styles.get_default_pose_landmarks_style(),
            )

            # Text labels for key body parts
            for idx, label in POSE_LABELS.items():
                if idx < len(pose_lms):
                    lm = pose_lms[idx]
                    if lm.visibility is not None and lm.visibility > 0.5:
                        cx, cy = int(lm.x * w), int(lm.y * h)
                        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                        cv2.rectangle(frame, (cx - 2, cy - th - 4), (cx + tw + 2, cy + 2), (0, 0, 0), -1)
                        cv2.putText(frame, label, (cx, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 1)

    # ── Draw Hands ──
    if latest_hands and latest_hands.hand_landmarks:
        for i, hand_lms in enumerate(latest_hands.hand_landmarks):
            drawing_utils.draw_landmarks(
                frame, hand_lms,
                HandLandmarksConnections.HAND_CONNECTIONS,
                drawing_styles.get_default_hand_landmarks_style(),
                drawing_styles.get_default_hand_connections_style(),
            )

            # Label the hand
            handedness = "Hand"
            if latest_hands.handedness and i < len(latest_hands.handedness):
                handedness = latest_hands.handedness[i][0].category_name + " Hand"
            wrist = hand_lms[0]
            cx, cy = int(wrist.x * w), int(wrist.y * h)
            color = (255, 100, 100) if "Left" in handedness else (100, 100, 255)
            cv2.putText(frame, handedness, (cx, cy - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    # ── PT UI Overlay ──
    try:
        if 'status' in locals():
            # Info Bar
            cv2.rectangle(frame, (0, 0), (w, 80), (30, 30, 30), -1)
            color = (0, 255, 0) if status['form_quality'] == 'good' else ((0, 165, 255) if status['form_quality'] == 'warning' else (255, 255, 255))
            
            cv2.putText(frame, f"REPS: {status['rep_count']}", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (88, 204, 2), 3)
            cv2.putText(frame, f"Angle: {status['angle']:.0f}", (250, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
            cv2.putText(frame, f"{status['state'].upper()}", (450, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
            cv2.putText(frame, f"{status['name']}", (w - 300, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 1)
            
            # Pain Warning Overlay
            pain_level, pain_msg, ear, mar = pain_status
            if pain_level != "normal":
                bar_color = (0, 165, 255) if pain_level == "warning" else (0, 0, 255)
                cv2.rectangle(frame, (0, 100), (w, 160), bar_color, -1)
                cv2.putText(frame, pain_msg, (50, 145), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
                # Debug stats
                cv2.putText(frame, f"EAR: {ear:.2f} MAR: {mar:.2f}", (w-250, 145), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)

    except Exception as e:
        print(f"UI Error: {e}")

    # ── FPS ──
    curr_time = time.time()
    fps = 1.0 / (curr_time - prev_time) if (curr_time - prev_time) > 0 else 0
    prev_time = curr_time
    cv2.putText(frame, f"FPS: {int(fps)}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
    cv2.putText(frame, "Pose(heavy) + Hands + Face Mesh | Press Q to quit", (10, h - 15),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)

    cv2.imshow("Body Tracker", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

pose_landmarker.close()
hand_landmarker.close()
face_landmarker.close()
cap.release()
cv2.destroyAllWindows()
