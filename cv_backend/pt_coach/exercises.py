#!/usr/bin/env python3
"""Exercise registry and helpers for PT coach demos."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ExerciseSpec:
    key: str
    code: str
    display_name: str
    repo_file: str
    correction_landmark_names: tuple[str, ...]


EXERCISE_SPECS: dict[str, ExerciseSpec] = {
    "arm_abduction": ExerciseSpec(
        key="arm_abduction",
        code="ex1",
        display_name="Arm Abduction",
        repo_file="ex1_reference.json",
        correction_landmark_names=(
            "left_shoulder",
            "right_shoulder",
            "left_elbow",
            "right_elbow",
            "left_wrist",
            "right_wrist",
        ),
    ),
    "arm_vw": ExerciseSpec(
        key="arm_vw",
        code="ex2",
        display_name="Arm VW",
        repo_file="ex2_reference.json",
        correction_landmark_names=(
            "left_shoulder",
            "right_shoulder",
            "left_elbow",
            "right_elbow",
            "left_wrist",
            "right_wrist",
        ),
    ),
    "leg_abduction": ExerciseSpec(
        key="leg_abduction",
        code="ex4",
        display_name="Leg Abduction",
        repo_file="ex4_reference.json",
        correction_landmark_names=(
            "left_hip",
            "right_hip",
            "left_knee",
            "right_knee",
            "left_ankle",
            "right_ankle",
            "left_foot_index",
            "right_foot_index",
        ),
    ),
    "squat": ExerciseSpec(
        key="squat",
        code="ex6",
        display_name="Squat",
        repo_file="ex6_reference.json",
        correction_landmark_names=(
            "left_knee",
            "right_knee",
            "left_ankle",
            "right_ankle",
            "left_foot_index",
            "right_foot_index",
        ),
    ),
}

EXERCISE_ALIASES = {
    "ex1": "arm_abduction",
    "ex2": "arm_vw",
    "ex4": "leg_abduction",
    "ex6": "squat",
}


def canonical_exercise_key(name: str) -> str:
    n = name.strip().lower().replace("-", "_").replace(" ", "_")
    if n in EXERCISE_SPECS:
        return n
    if n in EXERCISE_ALIASES:
        return EXERCISE_ALIASES[n]
    raise KeyError(f"Unknown exercise: {name}")


def get_exercise_spec(name: str) -> ExerciseSpec:
    return EXERCISE_SPECS[canonical_exercise_key(name)]


def available_exercises() -> list[str]:
    return sorted(EXERCISE_SPECS.keys())


def exercise_download_url(spec: ExerciseSpec) -> str:
    return (
        "https://raw.githubusercontent.com/jiekaitao/GatorMotion/main/skeleton_data/"
        f"{spec.repo_file}"
    )
