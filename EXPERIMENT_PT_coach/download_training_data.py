#!/usr/bin/env python3
"""Download PT training reference data for a specific exercise."""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

EXERCISE_URLS = {
    "squat": "https://raw.githubusercontent.com/jiekaitao/GatorMotion/main/skeleton_data/ex6_reference.json",
}


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
        choices=sorted(EXERCISE_URLS.keys()),
        help="Exercise to download",
    )
    parser.add_argument(
        "--output",
        default="data/raw/squat_reference.json",
        help="Output path for downloaded landmark data",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing file")
    args = parser.parse_args()

    out_path = Path(args.output)
    if out_path.exists() and not args.force:
        print(f"Already exists: {out_path}")
        print("Use --force to overwrite.")
    else:
        url = EXERCISE_URLS[args.exercise]
        print(f"Downloading {args.exercise} reference from:\n  {url}")
        download_file(url, out_path)
        validate_reference_json(out_path)
        print(f"Saved: {out_path}")

    validate_reference_json(out_path)
    print("Reference file validated.")
