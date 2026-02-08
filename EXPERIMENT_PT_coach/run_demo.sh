#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

EXERCISE="${1:-squat}"

python3 download_training_data.py --exercise "$EXERCISE" --output "data/raw/${EXERCISE}_reference.json"
python3 train_model.py \
  --exercise "$EXERCISE" \
  --reference-json "data/raw/${EXERCISE}_reference.json" \
  --model-out "models/${EXERCISE}_reference_model.npz" \
  --metadata-out "models/${EXERCISE}_reference_model.meta.json"

python3 live_coach.py \
  --exercise "$EXERCISE" \
  --reference-json "data/raw/${EXERCISE}_reference.json" \
  --model "models/${EXERCISE}_reference_model.npz" \
  --metadata "models/${EXERCISE}_reference_model.meta.json" \
  --pose-model models/pose_landmarker_heavy.task \
  --camera 0 \
  --mirror
