#!/usr/bin/env python3
"""
GatorMotion Dashboard Server — deploy on Vultr.

Receives JPEG + depth grid from iOS app via WebSocket,
runs MediaPipe pose detection, and pushes skeleton data
to a web dashboard served over HTTP.

Usage:
    pip install websockets mediapipe opencv-python-headless numpy
    python dashboard_server.py

Env vars:
    PORT           — WebSocket + HTTP port (default 8765)
    MODEL_PATH     — path to pose_landmarker_full.task (downloads if missing)
"""

from __future__ import annotations

import asyncio
import base64
import json
import math
import os
import struct
import time
from pathlib import Path

import cv2
import numpy as np

try:
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import (
        PoseLandmarker,
        PoseLandmarkerOptions,
        RunningMode,
    )
    HAS_MEDIAPIPE = True
except ImportError:
    HAS_MEDIAPIPE = False
    print("[WARN] mediapipe not installed — skeleton detection disabled")

from aiohttp import web

# ──────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────

PORT = int(os.getenv("PORT", "8765"))
MODEL_PATH = os.getenv("MODEL_PATH", "pose_landmarker_full.task")
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "pose_landmarker/pose_landmarker_full/float16/latest/"
    "pose_landmarker_full.task"
)

LANDMARK_NAMES = [
    "nose",
    "left_eye_inner", "left_eye", "left_eye_outer",
    "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear",
    "mouth_left", "mouth_right",
    "left_shoulder", "right_shoulder",
    "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
    "left_pinky", "right_pinky",
    "left_index", "right_index",
    "left_thumb", "right_thumb",
    "left_hip", "right_hip",
    "left_knee", "right_knee",
    "left_ankle", "right_ankle",
    "left_heel", "right_heel",
    "left_foot_index", "right_foot_index",
]

SKELETON_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 7),
    (0, 4), (4, 5), (5, 6), (6, 8),
    (9, 10),
    (11, 12),
    (11, 13), (13, 15), (15, 17), (17, 19), (19, 15), (15, 21),
    (12, 14), (14, 16), (16, 18), (18, 20), (20, 16), (16, 22),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (24, 26),
    (25, 27), (26, 28),
    (27, 29), (29, 31), (28, 30), (30, 32),
    (27, 31), (28, 32),
]

# ──────────────────────────────────────────────────────────────
# MediaPipe setup
# ──────────────────────────────────────────────────────────────

_landmarker = None
_mp_timestamp = 0


def _download_model():
    """Download pose model if not present."""
    if Path(MODEL_PATH).exists():
        return
    print(f"[INFO] Downloading pose model to {MODEL_PATH}...")
    import urllib.request
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print("[INFO] Model downloaded.")


def _init_mediapipe():
    global _landmarker
    if not HAS_MEDIAPIPE:
        return
    _download_model()
    options = PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    _landmarker = PoseLandmarker.create_from_options(options)
    print("[INFO] MediaPipe PoseLandmarker ready")


# ──────────────────────────────────────────────────────────────
# Frame processing
# ──────────────────────────────────────────────────────────────

def process_frame(payload: dict) -> dict | None:
    """Decode JPEG, run MediaPipe, sample depth, return skeleton dict."""
    global _mp_timestamp

    b64 = payload.get("video_frame_base64")
    if not b64:
        return None

    # Decode JPEG
    jpg_bytes = base64.b64decode(b64)
    arr = np.frombuffer(jpg_bytes, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        return None

    h, w = frame.shape[:2]

    # Run MediaPipe
    landmarks = []
    world_landmarks = []
    if _landmarker:
        _mp_timestamp += 33
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = _landmarker.detect_for_video(mp_image, _mp_timestamp)
        if result.pose_landmarks and len(result.pose_landmarks) > 0:
            landmarks = result.pose_landmarks[0]
        if result.pose_world_landmarks and len(result.pose_world_landmarks) > 0:
            world_landmarks = result.pose_world_landmarks[0]

    if not landmarks:
        return None

    # Depth grid lookup
    depth_grid = payload.get("depth_grid", [])
    grid_cols = payload.get("depth_grid_cols", 0)
    grid_rows = payload.get("depth_grid_rows", 0)

    def sample_depth(nx: float, ny: float) -> float:
        """Sample depth from transmitted grid at normalized coords."""
        if grid_cols <= 0 or grid_rows <= 0 or not depth_grid:
            return -1.0
        col = int(min(max(nx, 0), 1) * (grid_cols - 1))
        row = int(min(max(ny, 0), 1) * (grid_rows - 1))
        idx = row * grid_cols + col
        if 0 <= idx < len(depth_grid):
            v = depth_grid[idx]
            return v if v > 0 else -1.0
        return -1.0

    # Build skeleton data
    joints = {}
    keypoints_2d = {}
    point_depths_m = {}
    body_parts = []

    for i, lm in enumerate(landmarks):
        vis = lm.visibility if lm.visibility is not None else 1.0
        pres = lm.presence if lm.presence is not None else 1.0
        if vis < 0.5 or pres < 0.5:
            continue

        name = LANDMARK_NAMES[i] if i < len(LANDMARK_NAMES) else f"landmark_{i}"
        nx = min(max(lm.x, 0), 1)
        ny = min(max(lm.y, 0), 1)
        depth_m = sample_depth(nx, ny)

        keypoints_2d[name] = [nx, ny]
        if depth_m > 0:
            point_depths_m[name] = round(depth_m, 4)

        if i < len(world_landmarks):
            wl = world_landmarks[i]
            joints[name] = [round(wl.x, 5), round(wl.y, 5), round(wl.z, 5)]
        else:
            joints[name] = [round(lm.x, 5), round(lm.y, 5), round(lm.z, 5)]

        body_parts.append({
            "landmark_id": i,
            "name": name.upper(),
            "x": round(nx * (w - 1), 1),
            "y": round(ny * (h - 1), 1),
            "depth": round(lm.z, 4),
            "distance_cm": round(depth_m * 100, 1) if depth_m > 0 else -1.0,
        })

    return {
        "device": payload.get("device", "ios"),
        "timestamp": payload.get("timestamp", time.time()),
        "exercise": payload.get("exercise", ""),
        "depth_mode": payload.get("depth_mode", ""),
        "joints": joints,
        "keypoints_2d": keypoints_2d,
        "point_depths_m": point_depths_m,
        "body_part_depths": body_parts,
        "camera_width": payload.get("camera_width", w),
        "camera_height": payload.get("camera_height", h),
        "connections": SKELETON_CONNECTIONS,
    }


# ──────────────────────────────────────────────────────────────
# Dashboard HTML
# ──────────────────────────────────────────────────────────────

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GatorMotion Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#111;color:#fff;font-family:-apple-system,system-ui,sans-serif;
     display:flex;flex-direction:column;align-items:center;min-height:100vh}
h1{margin:20px 0 10px;font-size:24px}
#status{font-size:14px;color:#888;margin-bottom:10px}
#canvasWrap{position:relative;width:640px;height:480px;background:#000;border-radius:8px;overflow:hidden}
canvas{position:absolute;top:0;left:0;width:100%;height:100%}
#stats{margin:16px 0;font-size:13px;color:#aaa;display:flex;gap:20px}
.stat-label{color:#666}
#jointList{margin:10px 0;font-size:12px;color:#ccc;max-width:640px;
           display:flex;flex-wrap:wrap;gap:6px}
.joint-tag{background:#222;padding:3px 8px;border-radius:4px;white-space:nowrap}
.joint-tag .depth{color:#4ade80}
</style>
</head>
<body>
<h1>GatorMotion Dashboard</h1>
<div id="status">Connecting...</div>
<div id="canvasWrap">
  <canvas id="skeletonCanvas"></canvas>
</div>
<div id="stats">
  <span><span class="stat-label">FPS:</span> <span id="fps">0</span></span>
  <span><span class="stat-label">Joints:</span> <span id="jointCount">0</span></span>
  <span><span class="stat-label">Depth pts:</span> <span id="depthCount">0</span></span>
  <span><span class="stat-label">Device:</span> <span id="deviceInfo">-</span></span>
</div>
<div id="jointList"></div>

<script>
const canvas = document.getElementById('skeletonCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
let frameCount = 0, lastFpsTime = Date.now();

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(proto + '://' + location.host + '/dashboard');

  ws.onopen = () => { statusEl.textContent = 'Connected'; statusEl.style.color = '#4ade80'; };
  ws.onclose = () => {
    statusEl.textContent = 'Disconnected — reconnecting...';
    statusEl.style.color = '#f87171';
    setTimeout(connect, 1000);
  };
  ws.onerror = () => ws.close();

  ws.onmessage = (evt) => {
    const data = JSON.parse(evt.data);
    renderSkeleton(data);
    updateStats(data);
    frameCount++;
    const now = Date.now();
    if (now - lastFpsTime > 1000) {
      document.getElementById('fps').textContent = frameCount;
      frameCount = 0;
      lastFpsTime = now;
    }
  };
}

function renderSkeleton(data) {
  const cw = data.camera_width || 640;
  const ch = data.camera_height || 480;
  canvas.width = cw; canvas.height = ch;
  ctx.clearRect(0, 0, cw, ch);

  const parts = data.body_part_depths || [];
  const byId = new Map();
  parts.forEach(p => byId.set(p.landmark_id, p));

  const conns = data.connections || [];

  // Draw connections
  ctx.strokeStyle = 'rgba(0,255,0,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [s,e] of conns) {
    const sp = byId.get(s), ep = byId.get(e);
    if (!sp || !ep) continue;
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(ep.x, ep.y);
  }
  ctx.stroke();

  // Draw joints
  ctx.fillStyle = '#facc15';
  for (const p of parts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw labels
  ctx.font = '10px monospace';
  for (const p of parts) {
    const label = p.name + (p.distance_cm > 0 ? ' ' + p.distance_cm.toFixed(0) + 'cm' : '');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const tw = ctx.measureText(label).width;
    ctx.fillRect(p.x + 6, p.y - 10, tw + 4, 14);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, p.x + 8, p.y);
  }
}

function updateStats(data) {
  const parts = data.body_part_depths || [];
  const depths = data.point_depths_m || {};
  document.getElementById('jointCount').textContent = parts.length;
  document.getElementById('depthCount').textContent = Object.keys(depths).length;
  document.getElementById('deviceInfo').textContent = data.device || '-';

  const list = document.getElementById('jointList');
  list.innerHTML = parts.map(p => {
    const d = p.distance_cm > 0 ? p.distance_cm.toFixed(0) + 'cm' : '--';
    return '<span class="joint-tag">' + p.name + ' <span class="depth">' + d + '</span></span>';
  }).join('');
}

connect();
</script>
</body>
</html>
"""


# ──────────────────────────────────────────────────────────────
# Server (aiohttp handles both HTTP and WebSocket)
# ──────────────────────────────────────────────────────────────

dashboard_clients: set = set()


async def handle_index(request):
    """Serve dashboard HTML."""
    return web.Response(text=DASHBOARD_HTML, content_type="text/html")


async def handle_skeleton_ws(request):
    """WebSocket endpoint for iOS device — receives frames."""
    ws = web.WebSocketResponse(max_msg_size=10_000_000)
    await ws.prepare(request)
    print(f"[iOS] Connected from {request.remote}")

    async for msg in ws:
        if msg.type == web.WSMsgType.TEXT:
            try:
                payload = json.loads(msg.data)
            except json.JSONDecodeError:
                continue

            skeleton = process_frame(payload)
            if skeleton is None:
                continue

            skeleton_json = json.dumps(skeleton)

            dead = set()
            for client in dashboard_clients:
                try:
                    await client.send_str(skeleton_json)
                except Exception:
                    dead.add(client)
            dashboard_clients -= dead
        elif msg.type == web.WSMsgType.ERROR:
            break

    print("[iOS] Disconnected")
    return ws


async def handle_dashboard_ws(request):
    """WebSocket endpoint for browser dashboard — pushes skeleton data."""
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    dashboard_clients.add(ws)
    print(f"[Dashboard] Client connected ({len(dashboard_clients)} total)")

    async for msg in ws:
        if msg.type == web.WSMsgType.ERROR:
            break

    dashboard_clients.discard(ws)
    print(f"[Dashboard] Client disconnected ({len(dashboard_clients)} total)")
    return ws


def main():
    _init_mediapipe()

    app = web.Application(client_max_size=10_000_000)
    app.router.add_get("/", handle_index)
    app.router.add_get("/skeleton", handle_skeleton_ws)
    app.router.add_get("/dashboard", handle_dashboard_ws)

    print(f"[Server] Starting on port {PORT}")
    print(f"  iOS connects to:    ws://YOUR_VULTR_IP:{PORT}/skeleton")
    print(f"  Dashboard at:       http://YOUR_VULTR_IP:{PORT}/")

    web.run_app(app, host="0.0.0.0", port=PORT, print=None)


if __name__ == "__main__":
    main()
