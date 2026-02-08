#!/usr/bin/env python3
"""Download PT training reference data for a specific exercise."""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

from pt_coach.exercises import available_exercises, exercise_download_url, get_exercise_spec


def download_file(url: str, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url) as r:  # nosec B310
        content = r.read()
    dst.write_bytes(content)


def validate_reference_json(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    required = ["exercise", "landmark_names", "frames"]
    missing = [k for k in required if k not in data]
    if missing:
        raise ValueError(f"Invalid reference JSON. Missing keys: {missing}")
    if not data["frames"]:
        raise ValueError("Reference JSON has zero frames")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download PT exercise training landmarks")
    parser.add_argument(
        "--exercise",
        default="squat",
        choices=available_exercises() + ["all"],
        help="Exercise to download, or 'all'",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Output path for downloaded landmark data (only used when --exercise is a single exercise)",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing file")
    args = parser.parse_args()

    keys = available_exercises() if args.exercise == "all" else [args.exercise]

    for key in keys:
        spec = get_exercise_spec(key)
        if args.output and args.exercise != "all":
            out_path = Path(args.output)
        else:
            out_path = Path(f"data/raw/{spec.key}_reference.json")

        if out_path.exists() and not args.force:
            print(f"Already exists: {out_path}")
            print("Use --force to overwrite.")
        else:
            url = exercise_download_url(spec)
            print(f"Downloading {spec.key} reference from:\n  {url}")
            download_file(url, out_path)
            validate_reference_json(out_path)
            print(f"Saved: {out_path}")

        validate_reference_json(out_path)
        print(f"{spec.key} reference file validated.")
