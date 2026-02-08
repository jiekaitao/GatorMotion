# EXPERIMENT_PT_coach

Self-contained PT coaching demo for **Squat (Ex6)** using:
- MediaPipe Pose Landmarker for live webcam inference
- Downloaded PT reference landmarks (ex6) as training data
- A trained reference-matching model to generate live corrective messages

It outputs a live JSON payload and shows a camera window with a coaching message box (e.g. "Move your left foot left").

Live coaching view now includes:
- all active meaningful corrections (with anti-noise hysteresis so it is less pedantic)
- a "why" line for each correction (current vs target vs tolerance)
- on-frame arrows from current joint position to target position; arrows shrink as you move closer and disappear when within tolerance

## Folder layout

```
EXPERIMENT_PT_coach/
  data/
    raw/                 # downloaded training landmarks
  models/
    pose_landmarker_heavy.task
    hand_landmarker.task
    face_landmarker.task
    squat_reference_model.npz
    squat_reference_model.meta.json
  outputs/
    live_state.json      # updated continuously while running
  pt_coach/
    common.py
  download_training_data.py
  train_model.py
  live_coach.py
  run_demo.sh
  requirements.txt
```

## 1) Install

```bash
cd /Users/jietao/Documents/GitHub/PT_Hackathon/EXPERIMENT_PT_coach
python3 -m pip install -r requirements.txt
```

## 2) Download training data (squat)

```bash
python3 download_training_data.py --exercise squat --output data/raw/squat_reference.json
```

This downloads:
- `https://raw.githubusercontent.com/jiekaitao/GatorMotion/main/skeleton_data/ex6_reference.json`

## 3) Train model from the downloaded data

```bash
python3 train_model.py \
  --reference-json data/raw/squat_reference.json \
  --model-out models/squat_reference_model.npz \
  --metadata-out models/squat_reference_model.meta.json
```

## 4) Run live webcam demo

```bash
python3 live_coach.py \
  --model models/squat_reference_model.npz \
  --metadata models/squat_reference_model.meta.json \
  --pose-model models/pose_landmarker_heavy.task \
  --camera 0 \
  --mirror
```

Controls:
- `q` or `Esc` to exit.

Output while running:
- OpenCV window with pose + message panel
- `outputs/live_state.json` (live-updated each frame)

## Fast one-command run

```bash
./run_demo.sh
```

## Headless test mode (no camera)

Useful for CI/sanity checks:

```bash
python3 live_coach.py \
  --model models/squat_reference_model.npz \
  --metadata models/squat_reference_model.meta.json \
  --source-json data/raw/squat_reference.json \
  --no-window \
  --max-frames 120
```

## Notes

- Corrections are generated in a **body-centric coordinate frame**, so left/right instructions refer to the patient's body, not the screen direction.
- This demo is focused on one exercise (squat) and one reference dataset for rapid iteration.
- For clinical use, add calibration, multi-patient validation, and clinician-approved thresholds.
