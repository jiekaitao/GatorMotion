# MediaPipe WASM Bundle

This directory needs the @mediapipe/tasks-vision WASM files.

## Setup

```bash
npm install @mediapipe/tasks-vision
cp node_modules/@mediapipe/tasks-vision/wasm/vision_bundle.mjs ./vision_bundle.js
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js ./
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm ./
```

Then copy the pose model to webapp/models/:
```bash
cp ../../Models/pose_landmarker_full.task ../models/
```
