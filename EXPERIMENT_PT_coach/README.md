# EXPERIMENT_PT_coach

Self-contained PT coaching demo for multiple PT exercises:
- `arm_abduction` (Ex1)
- `arm_vw` (Ex2)
- `leg_abduction` (Ex4)
- `squat` (Ex6)

Using:
- MediaPipe Pose Landmarker for live webcam inference
- Downloaded PT reference landmarks as training data
- A trained reference-matching model to generate live corrective messages

It outputs a live JSON payload and shows a camera window with a coaching message box (e.g. "Move your left foot left").

Live coaching view now includes:
- all active meaningful corrections (with anti-noise hysteresis so it is less pedantic)
- a "why" line for each correction (current vs target vs tolerance)
- on-frame arrows from current joint position to target position; arrows shrink as you move closer and disappear when within tolerance
- temporal phase matching using the user's recent 1-second motion window against all reference windows
- a looped demo wireframe overlay to follow

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
    exercises.py
  download_training_data.py
  train_model.py
  train_all_models.py
  live_coach.py
  run_demo.sh
  requirements.txt
```

## 1) Install

```bash
cd /Users/jietao/Documents/GitHub/PT_Hackathon/EXPERIMENT_PT_coach
python3 -m pip install -r requirements.txt
```

## 2) Download training data

```bash
python3 download_training_data.py --exercise all
```

## 3) Train models

```bash
python3 train_all_models.py
```

Or single exercise:

```bash
python3 train_model.py --exercise squat
```

## 4) Run live webcam demo

```bash
python3 live_coach.py --exercise squat --camera 0 --mirror
```

## Fast one-command run

```bash
./run_demo.sh squat
./run_demo.sh arm_abduction
./run_demo.sh arm_vw
./run_demo.sh leg_abduction
```

## Headless test mode (no camera)

Useful for CI/sanity checks:

```bash
python3 live_coach.py \
  --exercise squat \
  --model models/squat_reference_model.npz \
  --metadata models/squat_reference_model.meta.json \
  --source-json data/raw/squat_reference.json \
  --no-window \
  --max-frames 120
```

## Notes

- Corrections are generated in a **body-centric coordinate frame**, so left/right instructions refer to the patient's body, not the screen direction.
- For clinical use, add calibration, multi-patient validation, and clinician-approved thresholds.
