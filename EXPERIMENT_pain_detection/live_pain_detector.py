"""
Standalone Live Pain Detection
===============================
cv2 → MediaPipe FaceLandmarker → align/crop → TaatiTeam comparative model → PSPI score

Usage:
    python live_pain_detector.py                    # webcam, combined checkpoint
    python live_pain_detector.py -unbc_only         # webcam, UNBC-only checkpoint
    python live_pain_detector.py --capture_refs 5   # capture 5 neutral refs first

Controls:
    r  - re-capture neutral reference frames
    q  - quit

Dependencies:
    pip install torch mediapipe opencv-python scikit-image numpy
"""

import argparse
import collections
import os
import sys
import time
import urllib.request

import cv2
import numpy as np
import torch
from skimage.transform import SimilarityTransform, PiecewiseAffineTransform, warp

import mediapipe as mp
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions, RunningMode
from mediapipe.tasks.python import BaseOptions

# Add repo root for model import
_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _DIR)
from models.comparative_model import ConvNetOrdinalLateFusion

# -----------------------------------------------------------------------
# MediaPipe 478 → 68-landmark mapping (standard dlib/FAN 68-pt layout)
# -----------------------------------------------------------------------
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

FACE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
)


def _ensure_face_model(path):
    """Download face_landmarker.task if not present."""
    if os.path.exists(path):
        return
    print(f"Downloading face landmarker model to {path} ...")
    urllib.request.urlretrieve(FACE_MODEL_URL, path)
    print(f"Done ({os.path.getsize(path)} bytes)")


# -----------------------------------------------------------------------
# Face processor — MediaPipe Tasks API
# -----------------------------------------------------------------------

class FaceProcessor:
    """Detect face + 478 landmarks via MediaPipe, return 68-pt subset."""

    def __init__(self, model_path):
        _ensure_face_model(model_path)
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
        """Returns (68, 2) float32 pixel-coords array or None.
        If target_size=(tw, th), landmarks are scaled to that resolution."""
        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        self._ts += 33  # fake increasing timestamp (ms)
        result = self.landmarker.detect_for_video(mp_image, self._ts)
        if not result.face_landmarks:
            return None
        face = result.face_landmarks[0]
        h, w = bgr_frame.shape[:2]
        # Landmarks come as 0-1 normalized, scale to target resolution
        if target_size is not None:
            tw, th = target_size
            all_lmks = np.array([(lm.x * tw, lm.y * th) for lm in face], dtype=np.float32)
        else:
            all_lmks = np.array([(lm.x * w, lm.y * h) for lm in face], dtype=np.float32)
        return all_lmks[MP_TO_68]

    def close(self):
        self.landmarker.close()


# -----------------------------------------------------------------------
# Alignment helpers (same math as TaatiTeam pain_detector.py)
# -----------------------------------------------------------------------

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
        max(0, min(bt, fh)):min(fh, max(bb, 0)),
        max(0, min(bl, fw)):min(fw, max(br, 0)),
        :,
    ]
    new = np.zeros((bb - bt, br - bl, 3), dtype=np.float32)
    new[
        max(0, min(bt, fh)) - bt:min(fh, max(bb, 0)) - bt,
        max(0, min(bl, fw)) - bl:min(fw, max(br, 0)) - bl,
        :,
    ] = sl
    h, w = new.shape[:2]
    m = max(h, w)
    sq = np.zeros((m, m, 3), dtype=np.float32)
    sq[(m - h) // 2: h + (m - h) // 2, (m - w) // 2: w + (m - w) // 2, :] = new
    return sq


# -----------------------------------------------------------------------
# Main detector
# -----------------------------------------------------------------------

class LivePainDetector:
    def __init__(self, checkpoint_path, num_outputs, image_size=160, smooth_window=7):
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.image_size = image_size
        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

        # Standard 68-pt face template
        self.mean_lmks = np.load(os.path.join(_DIR, "standard_face_68.npy")).astype(np.float32)
        self.mean_lmks = self.mean_lmks * 155 / self.mean_lmks.max()
        self.mean_lmks[:, 1] += 15

        # MediaPipe face processor
        self.face = FaceProcessor(os.path.join(_DIR, "face_landmarker.task"))

        # TaatiTeam comparative model
        self.model = ConvNetOrdinalLateFusion(num_outputs=num_outputs)
        self.model.load_state_dict(
            torch.load(checkpoint_path, map_location=self.device, weights_only=True)
        )
        self.model.to(self.device)
        self.model.eval()

        self.ref_tensors = []
        self.score_buf = collections.deque(maxlen=smooth_window)

    def _prep(self, bgr, scale_to=640):
        """Full pipeline: detect on full-res → align on scaled → crop → grayscale → CLAHE → tensor."""
        h, w = bgr.shape[:2]
        new_h = int(h * scale_to / w)
        resized = cv2.resize(bgr, (scale_to, new_h), interpolation=cv2.INTER_AREA)
        # Detect face on full-res frame, get landmarks scaled to resized coords
        lmks = self.face.get_68(bgr, target_size=(scale_to, new_h))
        if lmks is None:
            return None

        mean_lmks = self.mean_lmks * scale_to / 320
        img_f = resized.astype(np.float32) / 255.0

        # Similarity transform (eyes-level)
        img_a, lmks_a = similarity_transform(img_f, lmks, scale_to)
        # Piecewise affine warp (shape normalization)
        img_a = piecewise_affine(img_a, lmks_a, mean_lmks)
        # Crop
        li = mean_lmks.round().astype(np.int32)
        bbox = [li[:, 0].min(), li[:, 1].min(), li[:, 0].max(), li[:, 1].max()]
        img_a = crop_face(img_a, bbox)
        img_a = cv2.resize(img_a, (self.image_size, self.image_size))
        # Grayscale
        if img_a.ndim == 3 and img_a.shape[2] == 3:
            img_a = np.matmul(img_a, np.array([[0.114], [0.587], [0.299]]))
        # CLAHE
        img_a = self.clahe.apply((img_a * 255).astype(np.uint8))
        t = img_a.reshape(1, 1, self.image_size, self.image_size).astype(np.float32) / 255.0
        return torch.from_numpy(t).to(self.device)

    def add_reference(self, bgr):
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
                out = self.model(torch.cat([target, ref], dim=1)).detach().cpu().numpy()
                pspi = np.clip(out[0, -3:], 0, None)
                scores.append(pspi)
        raw = float(np.array(scores).mean())
        self.score_buf.append(raw)
        smoothed = float(np.median(list(self.score_buf)))
        return smoothed, raw

    def close(self):
        self.face.close()


# -----------------------------------------------------------------------
# HUD drawing
# -----------------------------------------------------------------------

def draw_hud(frame, smoothed, raw, fps, num_refs, capturing):
    h, w = frame.shape[:2]
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 80), (30, 30, 30), -1)
    cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)

    if capturing:
        cv2.putText(frame, "CAPTURING NEUTRAL FACE - hold still",
                    (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        cv2.putText(frame, f"References: {num_refs}",
                    (10, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
        return

    if smoothed is None:
        msg = "No face detected" if num_refs > 0 else "Press 'r' to capture neutral refs"
        cv2.putText(frame, msg, (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 255), 2)
    else:
        color = (0, 255, 0) if smoothed < 0.5 else (0, 200, 255) if smoothed < 2 else (0, 0, 255)
        cv2.putText(frame, f"Pain (PSPI): {smoothed:.2f}",
                    (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
        cv2.putText(frame, f"Raw: {raw:.2f}",
                    (10, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)
        # Vertical bar
        bx, by, bw, bh = w - 60, 90, 30, h - 120
        cv2.rectangle(frame, (bx - 2, by - 2), (bx + bw + 2, by + bh + 2), (80, 80, 80), -1)
        fill = int(min(1.0, smoothed / 16.0) * bh)
        cv2.rectangle(frame, (bx, by + bh - fill), (bx + bw, by + bh), color, -1)
        cv2.putText(frame, "0", (bx - 5, by + bh + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)
        cv2.putText(frame, "16", (bx - 10, by - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)

    cv2.putText(frame, f"FPS: {fps:.0f}  Refs: {num_refs}",
                (w - 200, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)
    cv2.putText(frame, "[r] recapture  [q] quit",
                (10, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (140, 140, 140), 1)


# -----------------------------------------------------------------------
# Capture loop helper
# -----------------------------------------------------------------------

def capture_refs(cap, detector, count):
    """Auto-capture neutral reference frames as soon as a face is found."""
    captured = 0
    while captured < count:
        ret, frame = cap.read()
        if not ret:
            break
        cv2.imshow("Pain Detection", frame)
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            return -1
        if detector.add_reference(frame):
            captured += 1
            print(f"  Reference {captured}/{count}")
    return captured


# -----------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Live Pain Detection (MediaPipe + TaatiTeam)")
    parser.add_argument("-unbc_only", action="store_true", help="UNBC-only checkpoint")
    parser.add_argument("--capture_refs", type=int, default=3, help="Neutral refs to capture (default 3)")
    parser.add_argument("--smooth_window", type=int, default=7, help="Smoothing window (default 7)")
    parser.add_argument("--camera", type=int, default=0, help="Camera index")
    args = parser.parse_args()

    if args.unbc_only:
        ckpt = os.path.join(_DIR, "checkpoints/59448122/59448122_3/model_epoch13.pt")
        n_out = 7
    else:
        ckpt = os.path.join(_DIR, "checkpoints/50342566/50343918_3/model_epoch4.pt")
        n_out = 40

    print(f"Loading model from {ckpt} ...")
    detector = LivePainDetector(ckpt, n_out, smooth_window=args.smooth_window)
    print(f"Device: {detector.device}")

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        print("ERROR: Cannot open camera")
        sys.exit(1)

    # Phase 1: auto-capture neutral references
    print(f"\n=== Auto-capturing {args.capture_refs} neutral references... ===")
    n = capture_refs(cap, detector, args.capture_refs)
    if n == -1:
        cap.release()
        cv2.destroyAllWindows()
        return
    print(f"\n=== {n} references captured. Starting pain detection... ===\n")

    # Phase 2: live detection
    fps_buf = collections.deque(maxlen=30)
    stagnant_since = None  # tracks when score first stayed above threshold
    STAGNANT_THRESHOLD = 0.25
    STAGNANT_DURATION = 10.0  # seconds before auto-recalibrate
    PROCESS_EVERY = 3  # run inference every Nth frame
    frame_count = 0
    smoothed, raw = None, None

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_count += 1
        if frame_count % PROCESS_EVERY == 0:
            t0 = time.time()
            smoothed, raw = detector.predict(frame)
            fps_buf.append(time.time() - t0)
        fps = len(fps_buf) / max(sum(fps_buf), 1e-6) if fps_buf else 0

        # Auto-recalibrate if score stays above threshold too long
        now = time.time()
        if smoothed is not None and smoothed > STAGNANT_THRESHOLD:
            if stagnant_since is None:
                stagnant_since = now
            elif now - stagnant_since > STAGNANT_DURATION:
                print("\n=== Score stagnant — auto-recalibrating... ===")
                detector.clear_references()
                n = capture_refs(cap, detector, args.capture_refs)
                if n == -1:
                    break
                print(f"=== {n} references captured. Resuming... ===\n")
                stagnant_since = None
                continue
        else:
            stagnant_since = None

        draw_hud(frame, smoothed, raw, fps, len(detector.ref_tensors), False)
        cv2.imshow("Pain Detection", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("r"):
            detector.clear_references()
            print(f"\n=== Re-capturing {args.capture_refs} references... ===")
            n = capture_refs(cap, detector, args.capture_refs)
            if n == -1:
                break
            print(f"=== {n} references captured. Resuming... ===\n")
            stagnant_since = None

    cap.release()
    cv2.destroyAllWindows()
    detector.close()


if __name__ == "__main__":
    main()
