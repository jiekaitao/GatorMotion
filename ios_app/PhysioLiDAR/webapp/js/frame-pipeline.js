// Orchestrates per-frame processing: decode → MediaPipe → depth → packet → render → send
class FramePipeline {
  constructor(mediapipe, renderer, transport, videoCanvas) {
    this.mediapipe = mediapipe;
    this.renderer = renderer;
    this.transport = transport;
    this.videoCanvas = videoCanvas;
    this.videoCtx = videoCanvas.getContext('2d');
    this.processing = false;
    this.img = new Image();
    this.frameCount = 0;
    this.lastLogTime = 0;
  }

  async processFrame(frameId, base64Jpeg, width, height) {
    if (this.processing) return; // Drop if previous frame still in flight
    this.processing = true;

    try {
      // Decode JPEG
      await new Promise((resolve, reject) => {
        this.img.onload = resolve;
        this.img.onerror = reject;
        this.img.src = 'data:image/jpeg;base64,' + base64Jpeg;
      });

      // Draw to video canvas (visible background)
      this.videoCanvas.width = width;
      this.videoCanvas.height = height;
      this.videoCtx.drawImage(this.img, 0, 0, width, height);

      // Run MediaPipe pose detection
      const result = this.mediapipe.detect(this.videoCanvas);
      if (!result || !result.landmarks || result.landmarks.length === 0) {
        this.processing = false;
        return;
      }

      // Extract visible landmarks for depth request
      const landmarks = [];
      result.landmarks[0].forEach((lm, i) => {
        const vis = lm.visibility != null ? lm.visibility : 1.0;
        const pres = lm.presence != null ? lm.presence : 1.0;
        if (vis >= 0.5 && pres >= 0.5) {
          landmarks.push({
            index: i,
            x: Math.min(Math.max(lm.x, 0), 1),
            y: Math.min(Math.max(lm.y, 0), 1)
          });
        }
      });

      // Request depth from native
      const depthResults = await NativeBridge.requestDepth(frameId, landmarks);

      // Build SkeletonPacket
      const config = NativeBridge.config || {
        isUsingLiDAR: false,
        depthMode: 'stereo_depth',
        exercise: 'standing_knee_flexion'
      };
      const packet = buildSkeletonPacket(result, depthResults, config, width, height);

      if (packet) {
        // Render skeleton overlay
        this.renderer.render(packet.body_part_depths, width, height);

        // Send to backend
        this.transport.send(packet);

        // Periodic logging
        this.frameCount++;
        const now = Date.now();
        if (now - this.lastLogTime > 2000) {
          this.lastLogTime = now;
          const depthCount = Object.keys(packet.point_depths_m).length;
          NativeBridge.log('info',
            'Processed ' + this.frameCount + ' frames, depth_pts=' + depthCount +
            ', joints=' + packet.body_part_depths.length
          );
        }
      }
    } catch (e) {
      NativeBridge.log('error', 'Frame pipeline: ' + e.message);
    } finally {
      this.processing = false;
    }
  }
}
