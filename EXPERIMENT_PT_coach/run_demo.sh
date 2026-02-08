#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

python3 download_training_data.py --exercise squat --output data/raw/squat_reference.json
python3 train_model.py \
  --reference-json data/raw/squat_reference.json \
  --model-out models/squat_reference_model.npz \
  --metadata-out models/squat_reference_model.meta.json

python3 live_coach.py \
  --model models/squat_reference_model.npz \
  --metadata models/squat_reference_model.meta.json \
  --pose-model models/pose_landmarker_heavy.task \
  --camera 0 \
  --mirror
