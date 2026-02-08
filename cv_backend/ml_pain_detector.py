"""
ML-based pain detection using TaatiTeam's ConvNetOrdinalLateFusion model.
Produces continuous PSPI (Prkachin & Solomon Pain Intensity) scores from
webcam frames by comparing current face against neutral reference frames.

Falls back to HeuristicPainDetector (EAR/MAR ratios) if torch is unavailable
or checkpoint files are missing.
"""

import collections
import logging
import os
import time

import cv2
import numpy as np

try:
    import torch
    import torch.nn as nn
    from skimage.transform import SimilarityTransform, PiecewiseAffineTransform, warp

    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    FaceLandmarker,
    FaceLandmarkerOptions,
    RunningMode,
)

from rep_counter import HeuristicPainDetector

logger = logging.getLogger(__name__)

_DIR = os.path.dirname(os.path.abspath(__file__))
_PAIN_MODELS_DIR = os.path.join(_DIR, "pain_models")
_FACE_MODEL = os.path.join(_DIR, "models", "face_landmarker.task")

# Default checkpoint (combined UNBC+BioVid, 40 outputs)
_DEFAULT_CHECKPOINT = os.path.join(
    _PAIN_MODELS_DIR, "checkpoints", "combined", "model_epoch4.pt"
)
_DEFAULT_NUM_OUTPUTS = 40

# MediaPipe 478 -> 68-landmark mapping (standard dlib/FAN 68-pt layout)
# fmt: off
MP_TO_68 = [
    # Jaw (0-16)
    10, 338, 297, 332, 284, 251, 389, 356, 454,
    323, 361, 288, 397, 365, 379, 378, 400,
    # Right eyebrow (17-21)
    46, 53, 52, 65, 55,
    # Left eyebrow (22-26)
    285, 295, 282, 283, 276,
    # Nose bridge (27-30)
    6, 197, 195, 5,
    # Nose bottom (31-35)
    48, 115, 220, 45, 275,
    # Right eye (36-41)
    33, 160, 158, 133, 153, 144,
    # Left eye (42-47)
    362, 385, 387, 263, 373, 380,
    # Outer lip (48-59)
    61, 39, 37, 0, 267, 269, 291, 405, 314, 17, 84, 181,
    # Inner lip (60-67)
    78, 82, 13, 312, 308, 317, 14, 87,
]
# fmt: on

PROCESS_EVERY = 3  # Run inference every Nth frame
NUM_CALIBRATION_FRAMES = 3
STAGNANT_THRESHOLD = 0.25
STAGNANT_DURATION = 10.0  # seconds before auto-recalibrate

# PSPI score thresholds
PSPI_WARNING = 1.0
PSPI_STOP = 3.0
PERSISTENCE_FRAMES = 2  # consecutive frames needed to trigger level change


# ---------------------------------------------------------------------------
# CNN Model (inlined from EXPERIMENT_pain_detection/models/comparative_model.py)
# ---------------------------------------------------------------------------

if TORCH_AVAILABLE:

    class ConvNetOrdinalLateFusion(nn.Module):
        def __init__(self, num_outputs=1, dropout=0, fc2_size=200):
            super().__init__()
            self.dropout = dropout
            self.dout1 = nn.Dropout2d(dropout)
            self.input_bn = nn.BatchNorm2d(2, affine=False)
            self.layer1 = nn.Sequential(
                nn.Conv2d(1, 64, kernel_size=5, stride=2),
                nn.BatchNorm2d(64),
                nn.ReLU(),
            )
            self.layer2 = nn.Sequential(
                nn.Conv2d(64, 128, kernel_size=5, stride=1),
                nn.BatchNorm2d(128),
                nn.ReLU(),
                nn.MaxPool2d(kernel_size=2, stride=2),
                nn.Dropout2d(dropout),
            )
            self.layer3 = nn.Sequential(
                nn.Conv2d(128, 128, kernel_size=5, stride=1),
                nn.BatchNorm2d(128),
                nn.ReLU(),
                nn.MaxPool2d(kernel_size=2, stride=2),
                nn.Dropout2d(dropout),
            )
            self.fc1 = nn.Linear(4608, fc2_size)
            self.fc2 = nn.Linear(fc2_size, num_outputs)

        def forward(self, x, return_features=False):
            out = self.layer1(x[:, 0:1, ...])
            out_ref = self.layer1(x[:, 1:, ...])
            out = out - out_ref
            out = nn.functional.max_pool2d(out, kernel_size=2, stride=2)
            out = self.dout1(out)
            out = self.layer2(out)
            out = self.layer3(out)
            features = self.fc1(out.reshape(out.size(0), -1))
            features = nn.functional.relu(features)
            pred = self.fc2(features)
            if return_features:
                return pred, features
            return pred


# ---------------------------------------------------------------------------
# FaceProcessor — MediaPipe Tasks API (VIDEO mode, separate from main.py)
# ---------------------------------------------------------------------------


class FaceProcessor:
    """Detect face + 478 landmarks via MediaPipe, return 68-pt subset."""

    def __init__(self, model_path: str):
        options = FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            running_mode=RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=0.3,
            min_face_presence_confidence=0.3,
            min_tracking_confidence=0.3,
        )
        self.landmarker = FaceLandmarker.create_from_options(options)
        self._ts = 0

    def get_68(self, bgr_frame, target_size=None):
        """Returns (68, 2) float32 pixel-coords array or None."""
        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        self._ts += 33  # fake increasing timestamp (ms)
        result = self.landmarker.detect_for_video(mp_image, self._ts)
        if not result.face_landmarks:
            return None
        face = result.face_landmarks[0]
        h, w = bgr_frame.shape[:2]
        if target_size is not None:
            tw, th = target_size
            all_lmks = np.array(
                [(lm.x * tw, lm.y * th) for lm in face], dtype=np.float32
            )
        else:
            all_lmks = np.array(
                [(lm.x * w, lm.y * h) for lm in face], dtype=np.float32
            )
        return all_lmks[MP_TO_68]

    def close(self):
        self.landmarker.close()


# ---------------------------------------------------------------------------
# Alignment helpers (same math as TaatiTeam pain_detector.py)
# ---------------------------------------------------------------------------


def similarity_transform(image, landmarks, scale_to):
    anchor_scale = 320 / scale_to
    anchor = np.array([[110, 71], [210, 71], [160, 170]], np.float32) / anchor_scale
    idx = [36, 45, 57]
    tform = SimilarityTransform()
    tform.estimate(landmarks[idx, :], anchor)
    sim_mat = tform.params[:2, :]
    dst = cv2.warpAffine(image, sim_mat, (image.shape[1], image.shape[0]))
    dst_lmks = np.matmul(
        np.concatenate((landmarks, np.ones((landmarks.shape[0], 1))), 1), sim_mat.T
    )[:, :2]
    return dst, dst_lmks


def piecewise_affine(image, source_lmks, target_lmks):
    anchor = list(range(31)) + [36, 39, 42, 45, 48, 51, 54, 57]
    tform = PiecewiseAffineTransform()
    tform.estimate(target_lmks[anchor, :], source_lmks[anchor, :])
    return warp(image, tform, output_shape=image.shape[:2]).astype(np.float32)


def crop_face(frame, bbox):
    fh, fw = frame.shape[:2]
    bl, bt, br, bb = [int(v) for v in bbox]
    sl = frame[
        max(0, min(bt, fh)) : min(fh, max(bb, 0)),
        max(0, min(bl, fw)) : min(fw, max(br, 0)),
        :,
    ]
    new = np.zeros((bb - bt, br - bl, 3), dtype=np.float32)
    new[
        max(0, min(bt, fh)) - bt : min(fh, max(bb, 0)) - bt,
        max(0, min(bl, fw)) - bl : min(fw, max(br, 0)) - bl,
        :,
    ] = sl
    h, w = new.shape[:2]
    m = max(h, w)
    sq = np.zeros((m, m, 3), dtype=np.float32)
    sq[(m - h) // 2 : h + (m - h) // 2, (m - w) // 2 : w + (m - w) // 2, :] = new
    return sq


# ---------------------------------------------------------------------------
# MLPainEngine — core preprocessing + inference (adapted from LivePainDetector)
# ---------------------------------------------------------------------------


class MLPainEngine:
    def __init__(
        self,
        checkpoint_path: str,
        num_outputs: int,
        image_size: int = 160,
        smooth_window: int = 7,
    ):
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.image_size = image_size
        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

        # Standard 68-pt face template
        self.mean_lmks = np.load(
            os.path.join(_PAIN_MODELS_DIR, "standard_face_68.npy")
        ).astype(np.float32)
        self.mean_lmks = self.mean_lmks * 155 / self.mean_lmks.max()
        self.mean_lmks[:, 1] += 15

        # MediaPipe face processor (VIDEO mode, separate instance)
        self.face = FaceProcessor(_FACE_MODEL)

        # Load CNN model
        self.model = ConvNetOrdinalLateFusion(num_outputs=num_outputs)
        self.model.load_state_dict(
            torch.load(checkpoint_path, map_location=self.device, weights_only=True)
        )
        self.model.to(self.device)
        self.model.eval()

        self.ref_tensors: list = []
        self.score_buf: collections.deque = collections.deque(maxlen=smooth_window)

    def _prep(self, bgr, scale_to=640):
        """Full pipeline: detect -> align -> crop -> grayscale -> CLAHE -> tensor."""
        h, w = bgr.shape[:2]
        new_h = int(h * scale_to / w)
        resized = cv2.resize(bgr, (scale_to, new_h), interpolation=cv2.INTER_AREA)
        lmks = self.face.get_68(bgr, target_size=(scale_to, new_h))
        if lmks is None:
            return None

        mean_lmks = self.mean_lmks * scale_to / 320
        img_f = resized.astype(np.float32) / 255.0

        img_a, lmks_a = similarity_transform(img_f, lmks, scale_to)
        img_a = piecewise_affine(img_a, lmks_a, mean_lmks)
        li = mean_lmks.round().astype(np.int32)
        bbox = [li[:, 0].min(), li[:, 1].min(), li[:, 0].max(), li[:, 1].max()]
        img_a = crop_face(img_a, bbox)
        img_a = cv2.resize(img_a, (self.image_size, self.image_size))
        if img_a.ndim == 3 and img_a.shape[2] == 3:
            img_a = np.matmul(img_a, np.array([[0.114], [0.587], [0.299]]))
        img_a = self.clahe.apply((img_a * 255).astype(np.uint8))
        t = (
            img_a.reshape(1, 1, self.image_size, self.image_size).astype(np.float32)
            / 255.0
        )
        return torch.from_numpy(t).to(self.device)

    def add_reference(self, bgr) -> bool:
        t = self._prep(bgr)
        if t is None:
            return False
        self.ref_tensors.append(t)
        return True

    def clear_references(self):
        self.ref_tensors.clear()
        self.score_buf.clear()

    def predict(self, bgr):
        """Returns (smoothed_pspi, raw_pspi) or (None, None)."""
        if not self.ref_tensors:
            return None, None
        target = self._prep(bgr)
        if target is None:
            return None, None

        scores = []
        with torch.no_grad():
            for ref in self.ref_tensors:
                out = (
                    self.model(torch.cat([target, ref], dim=1))
                    .detach()
                    .cpu()
                    .numpy()
                )
                pspi = np.clip(out[0, -3:], 0, None)
                scores.append(pspi)
        raw = float(np.array(scores).mean())
        self.score_buf.append(raw)
        smoothed = float(np.median(list(self.score_buf)))
        return smoothed, raw

    def close(self):
        self.face.close()


# ---------------------------------------------------------------------------
# MLPainDetector — wrapper with state machine and level mapping
# ---------------------------------------------------------------------------


class MLPainDetector:
    """
    ML-based pain detector with auto-calibration.

    States:
        CALIBRATING -> ACTIVE (with optional RECALIBRATING)

    Auto-captures the first few frames as neutral references.
    Falls back to HeuristicPainDetector if ML is unavailable.
    """

    def __init__(
        self,
        checkpoint_path: str = _DEFAULT_CHECKPOINT,
        num_outputs: int = _DEFAULT_NUM_OUTPUTS,
    ):
        self._use_ml = False
        self._engine: MLPainEngine | None = None
        self._heuristic = HeuristicPainDetector()

        if not TORCH_AVAILABLE:
            logger.warning("torch not available, using heuristic pain detection")
            return

        if not os.path.exists(checkpoint_path):
            logger.warning(
                "Checkpoint not found at %s, using heuristic pain detection",
                checkpoint_path,
            )
            return

        if not os.path.exists(_FACE_MODEL):
            logger.warning(
                "Face landmarker model not found at %s, using heuristic pain detection",
                _FACE_MODEL,
            )
            return

        try:
            self._engine = MLPainEngine(checkpoint_path, num_outputs)
            self._use_ml = True
            logger.info(
                "ML pain detector loaded (device=%s, checkpoint=%s)",
                self._engine.device,
                checkpoint_path,
            )
        except Exception as e:
            logger.warning("Failed to load ML pain model: %s, falling back to heuristic", e)

        # State machine
        self._state = "CALIBRATING"  # CALIBRATING | ACTIVE | RECALIBRATING
        self._calibration_count = 0
        self._frame_count = 0

        # Level persistence (require consecutive frames)
        self._warning_frames = 0
        self._stop_frames = 0

        # Auto-recalibration tracking
        self._stagnant_since: float | None = None

        # Latest values
        self._last_pspi: float | None = None
        self._last_level = "normal"

    @property
    def calibrated(self) -> bool:
        return self._state == "ACTIVE"

    def update(self, bgr: np.ndarray, face_landmarks_objects, w: int, h: int) -> dict:
        """
        Process a frame and return pain status dict.

        Args:
            bgr: BGR frame (cv2 format)
            face_landmarks_objects: list of face landmark objects (for heuristic EAR/MAR)
            w: frame width
            h: frame height

        Returns:
            dict with keys: level, message, face_detected, ear, mar, pspi_score, calibrated
        """
        # Compute heuristic EAR/MAR values for debug display
        ear, mar = 0.0, 0.0
        if face_landmarks_objects:
            result = self._heuristic.update(face_landmarks_objects, w, h)
            ear = round(result[2], 4)
            mar = round(result[3], 4)

        if not self._use_ml or self._engine is None:
            # Pure heuristic mode
            if face_landmarks_objects:
                return {
                    "level": result[0],
                    "message": result[1],
                    "face_detected": True,
                    "ear": ear,
                    "mar": mar,
                    "pspi_score": None,
                    "calibrated": True,
                }
            return {
                "level": "normal",
                "message": "",
                "face_detected": False,
                "ear": 0.0,
                "mar": 0.0,
                "pspi_score": None,
                "calibrated": True,
            }

        self._frame_count += 1

        # --- CALIBRATING / RECALIBRATING ---
        if self._state in ("CALIBRATING", "RECALIBRATING"):
            if self._engine.add_reference(bgr):
                self._calibration_count += 1
                logger.info(
                    "Calibration reference %d/%d captured",
                    self._calibration_count,
                    NUM_CALIBRATION_FRAMES,
                )
            if self._calibration_count >= NUM_CALIBRATION_FRAMES:
                self._state = "ACTIVE"
                self._stagnant_since = None
                logger.info("Pain detector calibrated, entering ACTIVE state")

            return {
                "level": "normal",
                "message": "Calibrating pain detection...",
                "face_detected": face_landmarks_objects is not None
                and len(face_landmarks_objects) > 0,
                "ear": ear,
                "mar": mar,
                "pspi_score": None,
                "calibrated": False,
            }

        # --- ACTIVE: run inference every Nth frame ---
        if self._frame_count % PROCESS_EVERY == 0:
            smoothed, _raw = self._engine.predict(bgr)
            if smoothed is not None:
                self._last_pspi = smoothed

                # Auto-recalibrate if PSPI stays above threshold too long
                now = time.time()
                if smoothed > STAGNANT_THRESHOLD:
                    if self._stagnant_since is None:
                        self._stagnant_since = now
                    elif now - self._stagnant_since > STAGNANT_DURATION:
                        logger.info("PSPI stagnant above threshold, auto-recalibrating")
                        self.recalibrate()
                        return {
                            "level": "normal",
                            "message": "Recalibrating pain detection...",
                            "face_detected": True,
                            "ear": ear,
                            "mar": mar,
                            "pspi_score": self._last_pspi,
                            "calibrated": False,
                        }
                else:
                    self._stagnant_since = None

        # Map PSPI to level with frame persistence
        pspi = self._last_pspi
        face_detected = pspi is not None

        if pspi is not None and pspi >= PSPI_STOP:
            self._stop_frames += 1
            self._warning_frames += 1
        elif pspi is not None and pspi >= PSPI_WARNING:
            self._stop_frames = 0
            self._warning_frames += 1
        else:
            self._stop_frames = 0
            self._warning_frames = 0

        if self._stop_frames >= PERSISTENCE_FRAMES:
            level = "stop"
            message = "Stop now. High pain detected."
        elif self._warning_frames >= PERSISTENCE_FRAMES:
            level = "warning"
            message = "Pain signs detected. Please take a break."
        else:
            level = "normal"
            message = ""

        self._last_level = level

        return {
            "level": level,
            "message": message,
            "face_detected": face_detected,
            "ear": ear,
            "mar": mar,
            "pspi_score": round(pspi, 3) if pspi is not None else None,
            "calibrated": True,
        }

    def recalibrate(self):
        """Reset references and re-enter calibration mode."""
        if self._engine:
            self._engine.clear_references()
        self._state = "RECALIBRATING"
        self._calibration_count = 0
        self._warning_frames = 0
        self._stop_frames = 0
        self._last_pspi = None
        self._stagnant_since = None

    def close(self):
        if self._engine:
            self._engine.close()
