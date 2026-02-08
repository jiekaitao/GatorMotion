"""
FastAPI WebSocket server for real-time body tracking with MediaPipe.
Receives base64-encoded JPEG frames, returns JSON landmark coordinates.
"""

import base64
import os

import cv2
import mediapipe as mp
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    FaceLandmarker,
    FaceLandmarkerOptions,
    HandLandmarker,
    HandLandmarkerOptions,
    PoseLandmarker,
    PoseLandmarkerOptions,
    RunningMode,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")

POSE_MODEL = os.path.join(MODELS_DIR, "pose_landmarker_heavy.task")
HAND_MODEL = os.path.join(MODELS_DIR, "hand_landmarker.task")
FACE_MODEL = os.path.join(MODELS_DIR, "face_landmarker.task")

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

app = FastAPI(title="GatorMotion CV API")

# Landmarkers loaded at startup
pose_landmarker: PoseLandmarker | None = None
hand_landmarker: HandLandmarker | None = None
face_landmarker: FaceLandmarker | None = None


@app.on_event("startup")
def load_models():
    global pose_landmarker, hand_landmarker, face_landmarker

    pose_landmarker = PoseLandmarker.create_from_options(
        PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=POSE_MODEL),
            running_mode=RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.5,
        )
    )

    hand_landmarker = HandLandmarker.create_from_options(
        HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=HAND_MODEL),
            running_mode=RunningMode.IMAGE,
            num_hands=2,
            min_hand_detection_confidence=0.5,
        )
    )

    face_landmarker = FaceLandmarker.create_from_options(
        FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=FACE_MODEL),
            running_mode=RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.5,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=False,
        )
    )


@app.on_event("shutdown")
def close_models():
    if pose_landmarker:
        pose_landmarker.close()
    if hand_landmarker:
        hand_landmarker.close()
    if face_landmarker:
        face_landmarker.close()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "models_loaded": all([pose_landmarker, hand_landmarker, face_landmarker]),
    }


def decode_frame(data: str) -> np.ndarray:
    """Decode a base64-encoded JPEG into an RGB numpy array."""
    raw = base64.b64decode(data)
    arr = np.frombuffer(raw, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def extract_landmarks(result, landmark_attr: str = "pose_landmarks"):
    """Convert MediaPipe landmark results to plain dicts."""
    landmarks_list = getattr(result, landmark_attr, None)
    if not landmarks_list:
        return []
    out = []
    for group in landmarks_list:
        out.append(
            [
                {
                    "x": lm.x,
                    "y": lm.y,
                    "z": lm.z,
                    **({"visibility": lm.visibility} if hasattr(lm, "visibility") and lm.visibility is not None else {}),
                    **({"label": POSE_LABELS[i]} if landmark_attr == "pose_landmarks" and i in POSE_LABELS else {}),
                }
                for i, lm in enumerate(group)
            ]
        )
    return out


@app.websocket("/ws/track")
async def ws_track(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()

            rgb = decode_frame(data)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            pose_result = pose_landmarker.detect(mp_image)
            hand_result = hand_landmarker.detect(mp_image)
            face_result = face_landmarker.detect(mp_image)

            handedness = []
            if hand_result.handedness:
                for h in hand_result.handedness:
                    handedness.append(h[0].category_name if h else None)

            response = {
                "pose": extract_landmarks(pose_result, "pose_landmarks"),
                "hands": extract_landmarks(hand_result, "hand_landmarks"),
                "handedness": handedness,
                "face": extract_landmarks(face_result, "face_landmarks"),
            }

            await websocket.send_json(response)
    except WebSocketDisconnect:
        pass
