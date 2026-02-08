"""
FastAPI WebSocket server for real-time body tracking with MediaPipe.
Receives base64-encoded JPEG frames, returns JSON landmark coordinates.

Supports detector selection via query param: /ws/track?detect=pose,hands,face
Runs selected detectors in parallel threads for maximum throughput.
"""

import asyncio
import base64
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from rep_counter import RepCounter, PainDetector, SixSevenDetector
from coach_engine import CoachV2Engine
from train_reference import ensure_models_exist
from pt_coach.common import landmarks_list_to_np

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

SKELETON_DATA_DIR = Path(__file__).parent.parent / "web" / "public" / "skeleton_data"
COACH_MODELS_DIR = Path(__file__).parent / "models"

coach_model_paths: dict[str, Path] = {}

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

# Thread pool for parallel detection (MediaPipe releases GIL during inference)
_executor = ThreadPoolExecutor(max_workers=3)

# Landmarkers loaded at startup
pose_landmarker: PoseLandmarker | None = None
hand_landmarker: HandLandmarker | None = None
face_landmarker: FaceLandmarker | None = None


@app.on_event("startup")
def load_models():
    global pose_landmarker, hand_landmarker, face_landmarker, coach_model_paths

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

    coach_model_paths = ensure_models_exist(SKELETON_DATA_DIR, COACH_MODELS_DIR)


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
    if not data:
        raise ValueError("Empty frame data")
    raw = base64.b64decode(data)
    arr = np.frombuffer(raw, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("Failed to decode JPEG frame")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def decode_frame_bytes(data: bytes) -> np.ndarray:
    """Decode raw JPEG bytes into an RGB numpy array."""
    if not data:
        raise ValueError("Empty frame data")
    arr = np.frombuffer(data, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("Failed to decode JPEG frame")
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


async def _process_frame(rgb: np.ndarray, detectors: set[str]) -> dict:
    """Run selected landmark detectors in parallel and return results."""
    loop = asyncio.get_event_loop()
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    # Launch selected detectors in parallel threads
    futures = {}
    if "pose" in detectors:
        futures["pose"] = loop.run_in_executor(_executor, pose_landmarker.detect, mp_image)
    if "hands" in detectors:
        futures["hands"] = loop.run_in_executor(_executor, hand_landmarker.detect, mp_image)
    if "face" in detectors:
        futures["face"] = loop.run_in_executor(_executor, face_landmarker.detect, mp_image)

    results = {}
    for key, fut in futures.items():
        results[key] = await fut

    # Build response
    pose_result = results.get("pose")
    hand_result = results.get("hands")
    face_result = results.get("face")

    handedness = []
    if hand_result and hand_result.handedness:
        for h in hand_result.handedness:
            handedness.append(h[0].category_name if h else None)

    return {
        "pose": extract_landmarks(pose_result, "pose_landmarks") if pose_result else [],
        "hands": extract_landmarks(hand_result, "hand_landmarks") if hand_result else [],
        "handedness": handedness,
        "face": extract_landmarks(face_result, "face_landmarks") if face_result else [],
    }


@app.websocket("/ws/track")
async def ws_track(websocket: WebSocket):
    # Parse detector selection from query params: ?detect=pose,hands,face
    detect_param = websocket.query_params.get("detect", "pose,hands,face")
    detectors = {d.strip() for d in detect_param.split(",")}

    await websocket.accept()
    try:
        while True:
            msg = await websocket.receive()

            if msg.get("type") == "websocket.disconnect":
                break

            try:
                if "bytes" in msg and msg["bytes"]:
                    rgb = decode_frame_bytes(msg["bytes"])
                else:
                    rgb = decode_frame(msg.get("text", ""))
            except (ValueError, Exception) as e:
                await websocket.send_json({"error": str(e)})
                continue

            response = await _process_frame(rgb, detectors)
            await websocket.send_json(response)
    except WebSocketDisconnect:
        pass


@app.websocket("/ws/exercise")
async def ws_exercise(websocket: WebSocket):
    """
    Exercise-aware WebSocket endpoint with rep counting and pain detection.
    Query params: ?exercise=arm_abduction&detect=pose,face
    """
    exercise_key = websocket.query_params.get("exercise", "arm_abduction")
    detect_param = websocket.query_params.get("detect", "pose,face")
    detectors = {d.strip() for d in detect_param.split(",")}
    # Always need pose for rep counting
    detectors.add("pose")

    rep_counter = RepCounter(exercise_key)
    pain_detector = PainDetector()
    six_seven_detector = SixSevenDetector()

    coach_engine: CoachV2Engine | None = None
    if exercise_key in coach_model_paths:
        coach_engine = CoachV2Engine(coach_model_paths[exercise_key])

    await websocket.accept()
    try:
        while True:
            msg = await websocket.receive()

            # Handle disconnect messages
            if msg.get("type") == "websocket.disconnect":
                break

            try:
                if "bytes" in msg and msg["bytes"]:
                    rgb = decode_frame_bytes(msg["bytes"])
                else:
                    rgb = decode_frame(msg.get("text", ""))
            except (ValueError, Exception) as e:
                await websocket.send_json({"error": str(e)})
                continue

            h, w = rgb.shape[:2]

            # Run landmark detection
            tracking = await _process_frame(rgb, detectors)

            # Rep counting from pose landmarks
            exercise_status = {
                "rep_count": rep_counter.rep_count,
                "angle": 0,
                "state": "waiting",
                "form_quality": "neutral",
                "name": rep_counter.config.name,
            }
            if tracking["pose"] and len(tracking["pose"]) > 0:
                # Convert dicts back to objects for RepCounter
                pose_lms = tracking["pose"][0]

                class LM:
                    def __init__(self, d):
                        self.x = d["x"]
                        self.y = d["y"]
                        self.z = d.get("z", 0)
                        self.visibility = d.get("visibility", 1.0)

                lm_objects = [LM(d) for d in pose_lms]
                exercise_status = rep_counter.update(lm_objects, w, h)

            # Pain detection from face landmarks
            pain_status = {
                "level": "normal",
                "message": "",
                "face_detected": False,
                "ear": 0.0,
                "mar": 0.0,
            }
            if (
                "face" in detectors
                and tracking["face"]
                and len(tracking["face"]) > 0
            ):
                face_lms = tracking["face"][0]

                class FLM:
                    def __init__(self, d):
                        self.x = d["x"]
                        self.y = d["y"]
                        self.z = d.get("z", 0)

                flm_objects = [FLM(d) for d in face_lms]
                result = pain_detector.update(flm_objects, w, h)
                pain_status = {
                    "level": result[0],
                    "message": result[1],
                    "face_detected": True,
                    "ear": round(result[2], 4),
                    "mar": round(result[3], 4),
                }

            # 6-7 Easter egg detection from pose wrist landmarks
            six_seven_status = {"triggered": False}
            if tracking["pose"] and len(tracking["pose"]) > 0:
                six_seven_status = six_seven_detector.update(lm_objects, w, h)

            # Coaching engine inference
            coaching_data = None
            if coach_engine and tracking["pose"] and len(tracking["pose"]) > 0:
                pose_landmarks_np = landmarks_list_to_np(tracking["pose"][0])
                coaching_data = coach_engine.infer(pose_landmarks_np, time.time())

            response = {
                **tracking,
                "exercise": exercise_status,
                "pain": pain_status,
                "six_seven": six_seven_status,
                "coaching": coaching_data,
            }
            await websocket.send_json(response)
    except WebSocketDisconnect:
        pass
