# EXPERIMENT_PT_coach

Portable, self-contained PT coaching demo for real-time webcam feedback.

Supported exercises:
- `arm_abduction` (Ex1)
- `arm_vw` (Ex2)
- `leg_abduction` (Ex4)
- `squat` (Ex6)

Core behavior:
- Real-time MediaPipe pose inference (33 landmarks)
- Temporal phase alignment of user motion to reference motion (`temporal_window_mse`)
- Actionable corrections ("move your right knee left") with "why" metrics
- On-frame vectors/arrows to target joint positions (only when landmark is reliably detected)
- Looped reference wireframe demo that snaps to best-fit phase and pulses on snap
- Live JSON state output for frontend integration

## 1) What this system is mathematically doing

The system is not training a deep network end-to-end for feedback. It is a data-driven reference matching pipeline:

1. Track pose landmarks each frame.
2. Normalize pose into a body-centric coordinate system.
3. Match user motion to reference motion in time (last 1 second window) via MSE.
4. Use the matched reference frame as target posture.
5. Compute per-joint deviations and convert them into directional coaching vectors.
6. Gate and debounce corrections to avoid pedantic/noisy feedback.

## 2) Coordinate normalization math

Input landmarks are `L_i = (x_i, y_i, z_i, vis_i)` for `i=0..32`.

Define:
- `lhip = L_left_hip.xy`
- `rhip = L_right_hip.xy`
- `lsh = L_left_shoulder.xy`
- `rsh = L_right_shoulder.xy`

Body frame origin and scale:
- `pelvis = (lhip + rhip) / 2`
- `hip_vec = lhip - rhip`
- `hip_width = ||hip_vec||`

Axes:
- `x_axis = hip_vec / ||hip_vec||`
- `shoulder_center = (lsh + rsh) / 2`
- `up_guess = shoulder_center - pelvis`
- `up_proj = up_guess - dot(up_guess, x_axis) * x_axis`
- `y_axis = up_proj / ||up_proj||`

Normalized body coordinates for any landmark `p`:
- `rel = p.xy - pelvis`
- `x_body = dot(rel, x_axis) / hip_width`
- `y_body = dot(rel, y_axis) / hip_width`
- `z_scaled = p.z / hip_width`

This yields `N_i = (x_body, y_body, z_scaled)`.

Why: this removes most camera translation/scale effects and keeps left/right instructions in patient coordinates.

## 3) Feature vector and training-time model

For each reference frame, selected landmarks are flattened into one feature vector:
- shoulders, elbows, wrists, hips, knees, ankles, foot indices

If there are `K` selected landmarks, feature dimension is `D = 3*K`.

Per-feature standardization is computed from reference data:
- `mu = mean(X_ref, axis=0)`
- `sigma = std(X_ref, axis=0)` (with epsilon guard)
- `X_ref_scaled = (X_ref - mu) / sigma`

Saved model artifacts:
- `ref_norm` (normalized landmarks per reference frame)
- `ref_features_scaled`
- `mu`, `sigma`
- metadata (distance calibration, tolerances, correction landmark set)

## 4) Temporal alignment math (last-second motion window)

For each live frame:
1. Compute `f_t` (scaled feature vector).
2. Append `(timestamp_t, f_t)` to history.
3. Keep features from last `align_window_ms` (default `1000 ms`).
4. Resample that sequence to fixed length `L` (`align_len`, typically 6..15 points).

Reference windows are precomputed:
- `W_j = X_ref_scaled[j : j+L]` for all valid `j`

Window matching objective:
- `MSE_j = mean((W_j - U)^2)` where `U` is user resampled window

Continuity penalty to avoid phase flicker:
- `MSE'_j = MSE_j + lambda * |end_idx_j - ref_idx_ema|`
- `lambda = 0.0008`

Choose best window `j* = argmin_j MSE'_j`.
Matched frame is end-of-window:
- `idx_raw = j* + (L - 1)`

EMA smoothing on matched frame index:
- `ref_idx_ema <- 0.8*ref_idx_ema + 0.2*idx_raw`
- `ref_idx = round(ref_idx_ema)`

Important: coaching vectors use this `ref_idx` as the target posture phase.

## 5) Quality and distance metrics

Single-frame nearest-neighbor distance (for quality only):
- `d = min_i ||f_t - X_ref_scaled[i]||`

Calibrated from reference leave-one-out nearest-neighbor stats:
- `p50`, `p90`, `p99`

Quality score:
- `quality = clip(1 - (d - p50)/(p99 - p50), 0, 1)`
- Smoothed with moving average over recent frames.

`temporal_distance` is also reported from temporal alignment path.

## 6) Correction vector math

For each correction landmark `k`:
- current point: `N_k = (x_k, y_k)`
- target point from matched phase: `R_k = (x*_k, y*_k)`
- delta: `dx = x_k - x*_k`, `dy = y_k - y*_k`

Tolerances from training data per landmark:
- `tol_x`, `tol_y`

Normalized errors:
- `ratio_x = |dx| / tol_x`
- `ratio_y = |dy| / tol_y`
- `err_ratio = max(ratio_x, ratio_y)`

Direction text is determined from dominant components (`left/right/up/down`).

Target vectors are emitted as:
- `delta_x_body = -dx`
- `delta_y_body = -dy`

And UI endpoint target in image coordinates is reconstructed with body frame axes.

## 7) Anti-pedantic gating and debouncing

A correction is considered only if landmark visibility is good:
- `visibility_k >= 0.55`

Activation thresholds (strict):
- `err_ratio >= 2.5`
- and `(|dx| >= 0.06 or |dy| >= 0.06)`

Clear thresholds:
- `err_ratio <= 1.35`
- or `(|dx| <= 0.022 and |dy| <= 0.03)`

Debounce streaks:
- activate after 3 consecutive activation frames
- clear after 2 consecutive clear frames

Global suppression of residual micro-corrections:
- if `quality_smooth > 0.96` and `err_ratio < 3.0`, correction is not shown

This is why feedback appears only for large, persistent mismatches.

## 8) Arrow/vector rendering behavior

For active corrections only:
- Arrow from current joint point to target joint point
- Target cross marker shown
- Arrow disappears when correction clears

Arrow smoothing (EMA on endpoints):
- `cur_s <- a_cur*cur_prev + (1-a_cur)*cur_now`, `a_cur=0.72`
- `tgt_s <- a_tgt*tgt_prev + (1-a_tgt)*tgt_now`, `a_tgt=0.82`

This reduces jitter and makes arrows shrink smoothly as user converges.

## 9) Demo wireframe loop + temporal snap behavior

A looped reference wireframe is rendered in the top-right video area.

The loop has its own playhead. On each frame, it can snap to aligned phase if:
- `temporal_distance <= snap_threshold`
- cooldown passed (`450 ms`)
- jump is meaningful (`>= 5` frames cyclic distance)

Default snap threshold:
- `snap_threshold = 1.1 * p90` (from model distance calibration)
- overridable with `--align-snap-threshold`

On snap:
- playhead jumps to matched reference frame and continues from there
- demo frame border pulses light green briefly
- wireframe segments pulse red briefly
- alignment notice appears in right panel bottom box
- developer console logs `[align] ...`

## 10) Mirror handling

When `--mirror` is enabled:
- camera frame is mirrored first for display
- landmark/arrow x-coordinates are mirrored during draw
- text remains readable (not mirrored)

## 11) Live JSON contract (key fields)

Top-level fields written every frame to `outputs/live_state.json`:
- `ts_ms`
- `exercise`: `name`, `display_name`, `phase`, `rep`, `reference_frame`
- `alignment`: `method`, `window_ms`, `window_samples`, `temporal_distance`, `snap_threshold`, `demo_loop_frame`, `demo_snapped`, optional `notice`
- `quality`: `score`, `confidence`, `distance`
- `measurements`
- `corrections[]`: each includes `id`, `severity`, `side`, `part`, `target`, `why`, `why_text`, `ui.current_xy_norm`, `ui.target_xy_norm`, `error_ratio`
- `speech`

## 12) Exercises and data sources

Configured in `pt_coach/exercises.py`:
- `arm_abduction` -> `ex1_reference.json`
- `arm_vw` -> `ex2_reference.json`
- `leg_abduction` -> `ex4_reference.json`
- `squat` -> `ex6_reference.json`

Downloaded from:
- `https://raw.githubusercontent.com/jiekaitao/GatorMotion/main/skeleton_data/`

## 13) Project layout

```
EXPERIMENT_PT_coach/
  data/raw/
    arm_abduction_reference.json
    arm_vw_reference.json
    leg_abduction_reference.json
    squat_reference.json
  models/
    pose_landmarker_heavy.task
    hand_landmarker.task
    face_landmarker.task
    <exercise>_reference_model.npz
    <exercise>_reference_model.meta.json
  outputs/
    live_state.json
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

## 14) Setup and run

Install:
```bash
cd /Users/jietao/Documents/GitHub/PT_Hackathon/EXPERIMENT_PT_coach
python3 -m pip install -r requirements.txt
```

Download all references:
```bash
python3 download_training_data.py --exercise all
```

Train all models:
```bash
python3 train_all_models.py
```

Run one exercise:
```bash
python3 live_coach.py --exercise squat --camera 0 --mirror
```

Override snap threshold:
```bash
python3 live_coach.py --exercise squat --camera 0 --mirror --align-snap-threshold 1.5
```

Quick script wrapper:
```bash
./run_demo.sh squat
./run_demo.sh arm_abduction
./run_demo.sh arm_vw
./run_demo.sh leg_abduction
```

Headless replay test:
```bash
python3 live_coach.py \
  --exercise squat \
  --model models/squat_reference_model.npz \
  --metadata models/squat_reference_model.meta.json \
  --source-json data/raw/squat_reference.json \
  --no-window \
  --max-frames 120
```

## 15) Tuning knobs

Most useful runtime knob:
- `--align-snap-threshold` controls snap aggressiveness for demo loop.

Key hardcoded tuning values in `live_coach.py` (inside `PTCoachEngine.__init__`):
- correction activation/clear thresholds
- arrow EMA smoothing
- temporal window size and alignment length

## 16) Current limitations

- Single-camera 2D+relative-depth pose; no true multi-view biomechanics.
- Tolerances are reference-data driven, not clinician-personalized.
- Rep counting heuristic is squat-oriented; other exercises can use custom phase/rep logic.
- Clinical deployment requires calibration protocol, validation studies, and safety policy.
