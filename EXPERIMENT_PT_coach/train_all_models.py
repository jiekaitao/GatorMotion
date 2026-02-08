#!/usr/bin/env python3
"""Download and train models for all available PT demo exercises."""

from __future__ import annotations

import subprocess
import sys

from pt_coach.exercises import available_exercises


def run(cmd: list[str]) -> None:
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    run([sys.executable, "download_training_data.py", "--exercise", "all"])
    for exercise in available_exercises():
        run([sys.executable, "train_model.py", "--exercise", exercise])
