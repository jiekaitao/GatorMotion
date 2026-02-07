"""
Real-time full body tracking with MediaPipe Tasks API.
Tracks: Pose (33 landmarks), Hands (21 each), Face Mesh (478 landmarks)
Press 'q' to quit.
"""

import cv2
import mediapipe as mp
import time
import os

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

    # ── Draw Pose ──
    if latest_pose and latest_pose.pose_landmarks:
        for pose_lms in latest_pose.pose_landmarks:
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
