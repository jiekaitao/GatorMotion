// MediaPipe WASM PoseLandmarker — loads from CDN
class MediaPipeRunner {
  constructor() {
    this.landmarker = null;
    this.isReady = false;
    this.lastTimestampMs = 0;
  }

  async init() {
    try {
      const { PoseLandmarker, FilesetResolver } = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm'
      );

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
      );

      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.isReady = true;
      NativeBridge.log('info', 'MediaPipe PoseLandmarker ready (CDN)');
    } catch (e) {
      NativeBridge.log('error', 'MediaPipe init failed: ' + e.message);
      throw e;
    }
  }

  detect(canvasOrImage) {
    if (!this.isReady || !this.landmarker) return null;

    this.lastTimestampMs += 33;

    try {
      return this.landmarker.detectForVideo(canvasOrImage, this.lastTimestampMs);
    } catch (e) {
      NativeBridge.log('error', 'MediaPipe detect error: ' + e.message);
      return null;
    }
  }
}
