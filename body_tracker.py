"""
Real-time full body tracking with MediaPipe Tasks API.
Tracks: Pose (33 landmarks), Hands (21 each), Face Mesh (478 landmarks)
Press 'q' to quit.
"""

import cv2
import mediapipe as mp
import time
import os
import shlex
import json

from coaching_pipeline import (
    build_ml_interpretation_prompt,
    GeminiCoach,
    ElevenLabsTTS,
)

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
ENV_PATH = os.path.join(SCRIPT_DIR, ".env")


def load_env_file(path: str) -> None:
    if not os.path.exists(path):
        return

    def parse_env_line(value: str) -> str:
        # Strip inline comments safely.
        lexer = shlex.shlex(value, posix=True)
        lexer.whitespace_split = True
        lexer.commenters = "#"
        tokens = list(lexer)
        return " ".join(tokens).strip().strip("'").strip('"')

    with open(path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[len("export "):].strip()
            key, value = line.split("=", 1)
            key = key.strip()
            value = parse_env_line(value.strip())
            if key and key not in os.environ:
                os.environ[key] = value


def load_ml_judgement() -> dict | None:
    """
    Optional hook for external ML posture classifier output.
    Expects a JSON file path in ML_JUDGEMENT_PATH.
    """
    path = os.getenv("ML_JUDGEMENT_PATH")
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except Exception:
        return None
    return None


def is_desired_position(ml_judgement: dict) -> bool:
    """
    Generic desired-position detector for flexible ML schemas.
    Returns True when ML output explicitly signals target position achieved.
    """
    if not isinstance(ml_judgement, dict):
        return False

    for key in ("desired_position", "target_reached", "position_correct", "is_correct"):
        if key in ml_judgement and isinstance(ml_judgement[key], bool):
            return ml_judgement[key]

    status = ml_judgement.get("status")
    if isinstance(status, str) and status.strip().lower() in {"correct", "aligned", "good", "ready", "ok"}:
        return True

    return False

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
    pose_landmarker.close()
    hand_landmarker.close()
    face_landmarker.close()
    exit(1)

load_env_file(ENV_PATH)
gemini_coach = GeminiCoach(api_key=os.getenv("GEMINI_API_KEY"))
tts_client = ElevenLabsTTS(
    api_key=os.getenv("ELEVENLABS_API_KEY"),
    voice_id=os.getenv("ELEVENLABS_VOICE_ID"),
)

latest_feedback = "Press V for voice coaching"
last_feedback_ts = 0.0
continuous_coaching = False
last_coaching_run = 0.0
coaching_interval = float(os.getenv("COACHING_INTERVAL_SEC", "3.0"))
show_joint_data = True

print("Camera opened. Press 'q' to quit.")
print(f"[Config] Gemini configured: {'yes' if gemini_coach.api_key else 'no'}")
print(f"[Config] ElevenLabs configured: {'yes' if tts_client.api_key and tts_client.voice_id else 'no'}")
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

            if show_joint_data:
                panel_x = 10
                panel_y = 90
                panel_w = 470
                panel_h = 20 + (len(POSE_LABELS) * 18)
                overlay = frame.copy()
                cv2.rectangle(overlay, (panel_x, panel_y), (panel_x + panel_w, panel_y + panel_h), (0, 0, 0), -1)
                cv2.addWeighted(overlay, 0.45, frame, 0.55, 0, frame)

                cv2.putText(
                    frame,
                    "Pose Joint Data (x, y, z, vis)",
                    (panel_x + 8, panel_y + 16),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.47,
                    (220, 220, 220),
                    1,
                )

                row = 0
                for idx, label in POSE_LABELS.items():
                    if idx >= len(pose_lms):
                        continue
                    lm = pose_lms[idx]
                    vis = lm.visibility if lm.visibility is not None else 0.0
                    text = f"{label:10s}  x={lm.x:.3f}  y={lm.y:.3f}  z={lm.z:.3f}  vis={vis:.2f}"
                    y = panel_y + 34 + (row * 18)
                    cv2.putText(
                        frame,
                        text,
                        (panel_x + 8, y),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.43,
                        (170, 255, 170),
                        1,
                    )
                    row += 1

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
    cv2.putText(frame, latest_feedback, (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (120, 255, 120), 2)
    cv2.putText(frame, "Pose(heavy) + Hands + Face Mesh | Press Q to quit", (10, h - 15),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
    cv2.putText(frame, "Press V to toggle continuous coaching", (10, h - 40),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
    cv2.putText(frame, "Press J to toggle joint data", (10, h - 65),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)

    cv2.imshow("Body Tracker", frame)

    key = cv2.waitKey(1) & 0xFF
    if key == ord("v"):
        continuous_coaching = not continuous_coaching
        mode = "ON" if continuous_coaching else "OFF"
        print(f"[Coaching] Continuous coaching {mode}")
        if continuous_coaching:
            last_coaching_run = 0.0
            latest_feedback = "Continuous coaching ON"
            last_feedback_ts = time.time()
        else:
            latest_feedback = "Continuous coaching OFF"
            last_feedback_ts = time.time()

    if key == ord("j"):
        show_joint_data = not show_joint_data
        state = "ON" if show_joint_data else "OFF"
        print(f"[Display] Joint data {state}")

    if key == ord("q"):
        break

    if continuous_coaching and (time.time() - last_coaching_run) >= coaching_interval:
        last_coaching_run = time.time()
        ml_judgement = load_ml_judgement()
        if not ml_judgement:
            latest_feedback = "No ML JSON found. Set ML_JUDGEMENT_PATH to a valid JSON file."
            continue

        if is_desired_position(ml_judgement):
            continuous_coaching = False
            latest_feedback = "Desired position reached. Coaching stopped."
            last_feedback_ts = time.time()
            print("[Coaching] Desired position reached. Stopping continuous coaching.")
            continue

        prompt = build_ml_interpretation_prompt(ml_judgement)
        feedback = gemini_coach.generate_feedback(prompt)
        latest_feedback = feedback
        last_feedback_ts = time.time()
        audio_path = tts_client.speak(feedback)
        print(f"[Coaching] {feedback}")
        if audio_path:
            print(f"[ElevenLabs] Audio saved to {audio_path}")
        else:
            print(f"[ElevenLabs] Failed: {tts_client.last_error or 'unknown error'}")

    # Reset overlay after a short duration so text does not crowd the screen.
    if last_feedback_ts and time.time() - last_feedback_ts > 6:
        latest_feedback = "Press V for voice coaching"
        last_feedback_ts = 0.0

pose_landmarker.close()
hand_landmarker.close()
face_landmarker.close()
cap.release()
cv2.destroyAllWindows()
