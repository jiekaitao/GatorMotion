import json
import os
import shutil
import subprocess
import tempfile
from typing import Dict, Optional

import requests

VOICE_COACH_SYSTEM_PROMPT = """
You convert machine-learning posture JSON into short spoken coaching for a person exercising.

Core behavior:
- Interpret the JSON semantically and infer the likely body correction.
- Output plain spoken coaching text only.
- 1 sentence preferred, 2 maximum.
- Max 24 words.
- Sound natural for ElevenLabs TTS.

Style:
- Direct, calm, supportive.
- Actionable body instruction (e.g., shoulder, hip, knee, foot, torso).
- If confidence is low or data is ambiguous, give a gentle neutral correction.

Safety:
- No diagnosis or medical claims.
- No technical jargon, schema names, or raw JSON values in output.
- Do not mention confidence numbers.

Example intent:
- Input like {"joint":"L.LEG","direction":"LEFT","magnitude":1.0} can map to
  "Move your left leg slightly inward."
""".strip()


def build_ml_interpretation_prompt(ml_payload: Dict[str, object]) -> str:
    ml_json = json.dumps(ml_payload, ensure_ascii=True)
    return (
        "Interpret this posture/joint-correction JSON and generate one short spoken coaching line. "
        "Focus on one highest-priority correction. "
        f"JSON: {ml_json}"
    )


class GeminiCoach:
    def __init__(self, api_key: Optional[str], model: Optional[str] = None):
        self.api_key = api_key
        self.model = model or os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

    def generate_feedback(self, prompt: str) -> str:
        if not self.api_key:
            return "Adjust your form slightly and keep steady breathing."

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
            f"?key={self.api_key}"
        )
        payload = {
            "system_instruction": {
                "parts": [{"text": VOICE_COACH_SYSTEM_PROMPT}],
            },
            "contents": [
                {
                    "parts": [{"text": prompt}],
                }
            ],
        }

        try:
            response = requests.post(url, json=payload, timeout=8)
            response.raise_for_status()
            data = response.json()
            text = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
                .strip()
            )
            return text or "Hold steady and make a small alignment correction."
        except Exception:
            return "Hold steady and make a small alignment correction."


class ElevenLabsTTS:
    def __init__(self, api_key: Optional[str], voice_id: Optional[str]):
        self.api_key = api_key
        self.voice_id = voice_id
        self.last_error: Optional[str] = None

    def speak(self, text: str) -> Optional[str]:
        if not self.api_key or not self.voice_id:
            self.last_error = "Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID."
            return None

        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}"
        headers = {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        payload = {
            "text": text,
            "model_id": os.getenv("ELEVENLABS_MODEL", "eleven_multilingual_v2"),
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.7,
            },
        }

        try:
            response = requests.post(url, headers=headers, json=payload, timeout=12)
            response.raise_for_status()

            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
                f.write(response.content)
                audio_path = f.name

            if not shutil.which("afplay"):
                self.last_error = "afplay not found on system PATH."
                return None

            subprocess.Popen(["afplay", audio_path])
            self.last_error = None
            return audio_path
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else "unknown"
            body = e.response.text[:200] if e.response is not None else ""
            self.last_error = f"ElevenLabs HTTP {status}: {body}"
            return None
        except Exception as e:
            self.last_error = f"ElevenLabs error: {e}"
            return None
