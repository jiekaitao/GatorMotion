# GatorMotion Voice Coaching

This project tracks body landmarks with MediaPipe and can generate spoken coaching by interpreting external ML JSON through Gemini, then sending text to ElevenLabs.

## Run

```bash
python3 body_tracker.py
```

Controls:
- `q`: quit
- `v`: toggle continuous coaching (repeats until desired position is reached)

## Environment Variables

Use a `.env` file in the project root with plain `KEY=VALUE` lines:

```env
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-1.5-flash

ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_MODEL=eleven_multilingual_v2

# Required for coaching: path to ML output JSON consumed by Gemini prompt
ML_JUDGEMENT_PATH=/absolute/path/to/ml_judgement.json
COACHING_INTERVAL_SEC=3.0
```

If keys are missing, the app still runs and falls back to local text feedback (no voice).

When you start the app, it prints:
- `[Config] Gemini configured: yes/no`
- `[Config] ElevenLabs configured: yes/no`

If voice fails on `v`, terminal logs now include the exact ElevenLabs error.

## ML JSON Example

Any schema is allowed. Gemini is prompted to infer a human coaching line from your model output.

```json
{
  "joint": "L.LEG",
  "direction": "LEFT",
  "magnitude": 1.0
}
```

Possible response:
`Move your left leg slightly inward.`

## Continuous Coaching Stop Condition

Coaching continues until ML JSON indicates the desired position was reached.
Supported flags in your JSON:

- `desired_position: true`
- `target_reached: true`
- `position_correct: true`
- `is_correct: true`
- `status: "correct"` (also accepts `"aligned"`, `"good"`, `"ready"`, `"ok"`)

## Dependency

Install Python packages used by the app:

```bash
pip install mediapipe opencv-python requests
```
