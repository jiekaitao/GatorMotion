"""
Rep counter and pain detection for real-time exercise tracking.
Extracted from Gator_analysis/body_tracker.py for use in the CV backend.
"""

import math
import time
from dataclasses import dataclass
from typing import Tuple


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
        if dt <= 0 or dt > 0.5:
            dt = 0.033
        self.last_time = current_time
        self.smoothed_value = (
            self.alpha * (self.smoothed_value + velocity * dt)
            + (1 - self.alpha) * raw_value
        )
        return self.smoothed_value

    def reset(self):
        self.smoothed_value = None
        self.last_time = None


class PIController:
    def __init__(self, kp: float = 1.0, ki: float = 1.0, ts: float = 0.2):
        self.kp = kp
        self.ki = ki
        self.ts = ts
        self.integrator_state = 0.0
        self.last_update_time = None

    def update(self, error: float) -> float:
        current_time = time.time()
        if self.last_update_time is None:
            self.last_update_time = current_time
        dt = current_time - self.last_update_time
        if dt >= self.ts:
            self.integrator_state += self.ts * error * self.ki
            self.last_update_time = current_time
        return self.kp * error + self.integrator_state

    def reset(self):
        self.integrator_state = 0.0
        self.last_update_time = None


def calculate_angle(a, b, c) -> float:
    ba = (a[0] - b[0], a[1] - b[1])
    bc = (c[0] - b[0], c[1] - b[1])
    dot_product = ba[0] * bc[0] + ba[1] * bc[1]
    magnitude_ba = math.sqrt(ba[0] ** 2 + ba[1] ** 2)
    magnitude_bc = math.sqrt(bc[0] ** 2 + bc[1] ** 2)
    if magnitude_ba * magnitude_bc == 0:
        return 0.0
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
        "arm_abduction": ExerciseConfig(
            "Arm Abduction", (24, 12, 14), 0, 140, threshold=20
        ),
        "arm_vw": ExerciseConfig(
            "Arm VW", (24, 12, 14), 30, 165, threshold=25, rest_threshold=40
        ),
        "squat": ExerciseConfig(
            "Squat", (12, 24, 26), 175, 145, threshold=15, rest_threshold=18
        ),
        "leg_abduction": ExerciseConfig(
            "Leg Abduction", (11, 23, 25), 172, 140, threshold=15, rest_threshold=15
        ),
    }

    def __init__(self, exercise_key: str = "arm_abduction"):
        self.config = self.EXERCISES.get(exercise_key, self.EXERCISES["arm_abduction"])
        self.filter = ComplementaryFilter(alpha=0.85)
        self.controller = PIController(kp=1.0, ki=0.5, ts=0.1)
        self.rep_count = 0
        self.state = "rest"
        self.current_angle = 0.0
        self.smoothed_angle = 0.0
        self.form_quality = "neutral"

    def update(self, landmarks, frame_width, frame_height):
        if not landmarks:
            return self._get_status()
        a, b, c = [landmarks[i] for i in self.config.joint_indices]
        if min(a.visibility, b.visibility, c.visibility) < 0.5:
            return self._get_status()

        raw_angle = calculate_angle(
            (a.x * frame_width, a.y * frame_height),
            (b.x * frame_width, b.y * frame_height),
            (c.x * frame_width, c.y * frame_height),
        )
        self.current_angle = raw_angle
        self.smoothed_angle = self.filter.update(raw_angle)

        # State Machine
        target = (
            self.config.peak_angle
            if self.state in ["moving", "peak"]
            else self.config.start_angle
        )
        self.controller.update(target - self.smoothed_angle)

        up = self.config.peak_angle > self.config.start_angle
        at_peak = (
            self.smoothed_angle > (self.config.peak_angle - self.config.threshold)
            if up
            else self.smoothed_angle < (self.config.peak_angle + self.config.threshold)
        )
        at_rest = (
            self.smoothed_angle < (self.config.start_angle + self.config.rest_threshold)
            if up
            else self.smoothed_angle
            > (self.config.start_angle - self.config.rest_threshold)
        )

        if self.state == "rest" and not at_rest:
            self.state = "moving"
        elif self.state == "moving" and at_peak:
            self.state = "peak"
        elif self.state == "peak" and not at_peak:
            self.state = "returning"
        elif self.state == "returning" and at_rest:
            self.state = "rest"
            self.rep_count += 1
            self.controller.reset()

        # Form Check
        if self.smoothed_angle > 170 or self.smoothed_angle < 10:
            self.form_quality = "warning"
        elif self.state == "peak":
            self.form_quality = "good"
        else:
            self.form_quality = "neutral"

        return self._get_status()

    def _get_status(self):
        return {
            "rep_count": self.rep_count,
            "angle": self.smoothed_angle,
            "state": self.state,
            "form_quality": self.form_quality,
            "name": self.config.name,
        }

    def reset(self):
        self.rep_count = 0
        self.state = "rest"
        self.filter.reset()
        self.controller.reset()


class PainDetector:
    def __init__(self):
        self.pain_level = "normal"
        self.message = ""
        self.EAR_WARNING = 0.20
        self.EAR_STOP = 0.15
        self.MAR_WARNING = 0.50
        self.MAR_STOP = 0.75

    def update(self, face_landmarks, w, h):
        if not face_landmarks:
            return "normal", "", 0, 0

        def dist(i1, i2):
            p1 = face_landmarks[i1]
            p2 = face_landmarks[i2]
            return math.hypot((p1.x - p2.x) * w, (p1.y - p2.y) * h)

        ear_l = dist(159, 145) / (dist(33, 133) + 1e-6)
        ear_r = dist(386, 374) / (dist(362, 263) + 1e-6)
        ear = (ear_l + ear_r) / 2.0

        mar = dist(13, 14) / (dist(78, 308) + 1e-6)

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
