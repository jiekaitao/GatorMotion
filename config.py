from __future__ import annotations

import os
import shlex
from pathlib import Path
from typing import Union

SCRIPT_DIR = Path(__file__).resolve().parent
ENV_PATH = SCRIPT_DIR / ".env"


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        if line.startswith("export "):
            line = line[len("export ") :].strip()

        key, value = line.split("=", 1)
        key = key.strip()

        lexer = shlex.shlex(value.strip(), posix=True)
        lexer.whitespace_split = True
        lexer.commenters = "#"
        parsed = " ".join(list(lexer)).strip().strip('"').strip("'")

        if key and key not in os.environ:
            os.environ[key] = parsed


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _camera_source_from_env() -> Union[int, str]:
    raw = os.getenv("CAMERA_SOURCE", "0").strip()
    if raw.isdigit() or (raw.startswith("-") and raw[1:].isdigit()):
        return int(raw)
    return raw


_load_env_file(ENV_PATH)

USE_IOS_STREAM = _bool_env("USE_IOS_STREAM", True)
IOS_DEVICE_IS_SERVER = _bool_env("IOS_DEVICE_IS_SERVER", True)
IOS_STREAM_HOST = os.getenv("IOS_STREAM_HOST", "192.168.1.100")
IOS_STREAM_PORT = int(os.getenv("IOS_STREAM_PORT", "8765"))
IOS_STREAM_PATH = os.getenv("IOS_STREAM_PATH", "/skeleton")
IOS_STREAM_SCHEME = os.getenv("IOS_STREAM_SCHEME", "ws").strip().lower()
IOS_STREAM_RECONNECT_DELAY_SEC = float(os.getenv("IOS_STREAM_RECONNECT_DELAY_SEC", "1.0"))
IOS_MAX_PROCESS_FPS = max(float(os.getenv("IOS_MAX_PROCESS_FPS", "15")), 0.0)
IOS_ENABLE_VIDEO_FRAME_STREAM = _bool_env("IOS_ENABLE_VIDEO_FRAME_STREAM", True)
IOS_INCLUDE_ALL_JOINTS = _bool_env("IOS_INCLUDE_ALL_JOINTS", False)
SHOW_IOS_PREVIEW = _bool_env("SHOW_IOS_PREVIEW", True)
IOS_PREVIEW_WIDTH = int(os.getenv("IOS_PREVIEW_WIDTH", "960"))
IOS_PREVIEW_HEIGHT = int(os.getenv("IOS_PREVIEW_HEIGHT", "720"))
IOS_PREVIEW_SHOW_LABELS = _bool_env("IOS_PREVIEW_SHOW_LABELS", True)
IOS_PREVIEW_OVERLAY_ON_CAMERA = _bool_env("IOS_PREVIEW_OVERLAY_ON_CAMERA", False)
IOS_PREVIEW_SHOW_MEDIAPIPE = _bool_env("IOS_PREVIEW_SHOW_MEDIAPIPE", True)
ENABLE_MEDIAPIPE_FUSION = _bool_env("ENABLE_MEDIAPIPE_FUSION", True)
USE_IOS_VIDEO_FOR_MEDIAPIPE = _bool_env("USE_IOS_VIDEO_FOR_MEDIAPIPE", True)
WARN_IF_IOS_VIDEO_MISSING = _bool_env("WARN_IF_IOS_VIDEO_MISSING", True)
IOS_DROP_PAYLOADS_IF_BUSY = _bool_env("IOS_DROP_PAYLOADS_IF_BUSY", True)
IOS_DISABLE_JOINT_STABILIZATION = _bool_env("IOS_DISABLE_JOINT_STABILIZATION", True)
MEDIAPIPE_POSE_TASK_MODEL = os.getenv(
    "MEDIAPIPE_POSE_TASK_MODEL",
    str(SCRIPT_DIR / "models" / "pose_landmarker_heavy.task"),
)
MEDIAPIPE_FUSION_WEIGHT = float(os.getenv("MEDIAPIPE_FUSION_WEIGHT", "0.35"))
MEDIAPIPE_FUSION_VISIBILITY_MIN = float(os.getenv("MEDIAPIPE_FUSION_VISIBILITY_MIN", "0.60"))
MEDIAPIPE_FUSION_MAX_JOINT_DELTA = float(os.getenv("MEDIAPIPE_FUSION_MAX_JOINT_DELTA", "0.18"))
IOS_JOINT_SMOOTHING_ALPHA = _float_env("IOS_JOINT_SMOOTHING_ALPHA", 0.45)
IOS_JOINT_MAX_JUMP_M = _float_env("IOS_JOINT_MAX_JUMP_M", 0.35)
ARM_DEPTH_FILTER_ALPHA = _float_env("ARM_DEPTH_FILTER_ALPHA", 0.40)
ARM_DEPTH_VELOCITY_DEADBAND_MPS = _float_env("ARM_DEPTH_VELOCITY_DEADBAND_MPS", 0.03)
ARM_DEPTH_HALF_CYCLE_MIN_AMPLITUDE_M = _float_env("ARM_DEPTH_HALF_CYCLE_MIN_AMPLITUDE_M", 0.04)
ARM_DEPTH_HALF_CYCLE_MIN_DURATION_SEC = _float_env("ARM_DEPTH_HALF_CYCLE_MIN_DURATION_SEC", 0.20)
MEDIAPIPE_FUSION_WEIGHT = max(0.0, min(1.0, MEDIAPIPE_FUSION_WEIGHT))
MEDIAPIPE_FUSION_VISIBILITY_MIN = max(0.0, min(1.0, MEDIAPIPE_FUSION_VISIBILITY_MIN))
MEDIAPIPE_FUSION_MAX_JOINT_DELTA = max(0.01, min(1.0, MEDIAPIPE_FUSION_MAX_JOINT_DELTA))
IOS_JOINT_SMOOTHING_ALPHA = max(0.0, min(1.0, IOS_JOINT_SMOOTHING_ALPHA))
IOS_JOINT_MAX_JUMP_M = max(0.05, IOS_JOINT_MAX_JUMP_M)
ARM_DEPTH_FILTER_ALPHA = max(0.01, min(1.0, ARM_DEPTH_FILTER_ALPHA))
ARM_DEPTH_VELOCITY_DEADBAND_MPS = max(0.0, ARM_DEPTH_VELOCITY_DEADBAND_MPS)
ARM_DEPTH_HALF_CYCLE_MIN_AMPLITUDE_M = max(0.005, ARM_DEPTH_HALF_CYCLE_MIN_AMPLITUDE_M)
ARM_DEPTH_HALF_CYCLE_MIN_DURATION_SEC = max(0.01, ARM_DEPTH_HALF_CYCLE_MIN_DURATION_SEC)
if IOS_STREAM_SCHEME in {"http", "ws"}:
    IOS_STREAM_SCHEME = "ws"
elif IOS_STREAM_SCHEME in {"https", "wss"}:
    IOS_STREAM_SCHEME = "wss"
else:
    IOS_STREAM_SCHEME = "ws"

CAMERA_SOURCE = _camera_source_from_env()
DEFAULT_EXERCISE = os.getenv("DEFAULT_EXERCISE", "standing_knee_flexion")
SHOW_CAMERA_PREVIEW = _bool_env("SHOW_CAMERA_PREVIEW", True)

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/pt_app")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "pt_app")
SESSIONS_COLLECTION = os.getenv("SESSIONS_COLLECTION", "sessions")
EXERCISE_TEMPLATES_COLLECTION = os.getenv("EXERCISE_TEMPLATES_COLLECTION", "exerciseTemplates")
LOG_EVERY_N_FRAMES = max(int(os.getenv("LOG_EVERY_N_FRAMES", "10")), 1)
