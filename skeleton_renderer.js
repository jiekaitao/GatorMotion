/**
 * SkeletonRenderer - Renders MediaPipe skeleton animations on HTML5 Canvas.
 *
 * Loads JSON skeleton data (from skeleton_extractor.py) and draws smooth
 * looping skeleton animations. Supports customizable colors, line widths,
 * playback speed, and mirror mode.
 *
 * Usage:
 *   const renderer = new SkeletonRenderer(canvasElement, {
 *     color: '#4A90D9',
 *     lineWidth: 3,
 *     jointRadius: 5,
 *   });
 *   const data = await fetch('skeleton_data/sit_to_stand_reference.json').then(r => r.json());
 *   renderer.load(data);
 *   renderer.play();
 */

class SkeletonRenderer {
  // MediaPipe Pose 33-landmark connection pairs
  static CONNECTIONS = [
    // Face
    [0, 1], [1, 2], [2, 3], [3, 7],   // left eye
    [0, 4], [4, 5], [5, 6], [6, 8],   // right eye
    [9, 10],                            // mouth
    // Torso
    [11, 12],                           // shoulders
    [11, 23], [12, 24],                 // shoulder to hip
    [23, 24],                           // hips
    // Left arm
    [11, 13], [13, 15],                 // shoulder-elbow-wrist
    [15, 17], [15, 19], [15, 21],       // wrist to fingers
    [17, 19],
    // Right arm
    [12, 14], [14, 16],
    [16, 18], [16, 20], [16, 22],
    [18, 20],
    // Left leg
    [23, 25], [25, 27],                 // hip-knee-ankle
    [27, 29], [27, 31], [29, 31],       // ankle-heel-foot
    // Right leg
    [24, 26], [26, 28],
    [28, 30], [28, 32], [30, 32],
  ];

  // Simplified connections (13-point: major joints only)
  static CONNECTIONS_SIMPLE = [
    [11, 12],           // shoulders
    [11, 23], [12, 24], // torso
    [23, 24],           // hips
    [11, 13], [13, 15], // left arm
    [12, 14], [14, 16], // right arm
    [23, 25], [25, 27], // left leg
    [24, 26], [26, 28], // right leg
  ];

  /**
   * @param {HTMLCanvasElement} canvas - Canvas element to render on.
   * @param {Object} options - Rendering options.
   * @param {string} options.color - Skeleton line color (default: '#4A90D9').
   * @param {string} options.jointColor - Joint circle color (default: same as color).
   * @param {number} options.lineWidth - Line width in pixels (default: 3).
   * @param {number} options.jointRadius - Joint circle radius (default: 5).
   * @param {number} options.speed - Playback speed multiplier (default: 1.0).
   * @param {boolean} options.mirror - Mirror horizontally (default: false).
   * @param {boolean} options.simplified - Use simplified 13-point skeleton (default: false).
   * @param {boolean} options.showConfidence - Dim low-confidence joints (default: false).
   * @param {string} options.backgroundColor - Canvas background color (default: '#1a1a2e').
   * @param {number} options.padding - Padding ratio 0-1 around skeleton (default: 0.1).
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.color = options.color || '#4A90D9';
    this.jointColor = options.jointColor || this.color;
    this.lineWidth = options.lineWidth || 3;
    this.jointRadius = options.jointRadius || 5;
    this.speed = options.speed || 1.0;
    this.mirror = options.mirror || false;
    this.simplified = options.simplified || false;
    this.showConfidence = options.showConfidence || false;
    this.backgroundColor = options.backgroundColor || '#1a1a2e';
    this.padding = options.padding || 0.1;

    this.data = null;
    this.frames = [];
    this.fps = 30;
    this.currentFrame = 0;
    this.playing = false;
    this.animationId = null;
    this.lastFrameTime = 0;

    this._onFrame = this._onFrame.bind(this);
  }

  /**
   * Load skeleton data from a parsed JSON object.
   * @param {Object} data - Skeleton data from skeleton_extractor.py.
   */
  load(data) {
    this.data = data;
    this.frames = data.frames || [];
    this.fps = data.fps || 30;
    this.currentFrame = 0;
    this.lastFrameTime = 0;

    if (this.frames.length > 0) {
      this._drawFrame(0);
    }
  }

  /** Start or resume animation playback. */
  play() {
    if (this.frames.length === 0) return;
    this.playing = true;
    this.lastFrameTime = performance.now();
    this.animationId = requestAnimationFrame(this._onFrame);
  }

  /** Pause animation. */
  pause() {
    this.playing = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /** Stop and reset to first frame. */
  stop() {
    this.pause();
    this.currentFrame = 0;
    if (this.frames.length > 0) this._drawFrame(0);
  }

  /** Step forward one frame. */
  stepForward() {
    if (this.frames.length === 0) return;
    this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    this._drawFrame(this.currentFrame);
  }

  /**
   * Set playback speed.
   * @param {number} speed - Multiplier (0.25 to 4.0).
   */
  setSpeed(speed) {
    this.speed = Math.max(0.25, Math.min(4.0, speed));
  }

  /**
   * Set mirror mode.
   * @param {boolean} mirrored
   */
  setMirror(mirrored) {
    this.mirror = mirrored;
    if (!this.playing && this.frames.length > 0) {
      this._drawFrame(this.currentFrame);
    }
  }

  /** Get current exercise name. */
  getExerciseName() {
    return this.data ? this.data.exercise : '';
  }

  /** Get total frame count. */
  getTotalFrames() {
    return this.frames.length;
  }

  /** Get current frame index. */
  getCurrentFrame() {
    return this.currentFrame;
  }

  /** Get playback progress (0 to 1). */
  getProgress() {
    if (this.frames.length === 0) return 0;
    return this.currentFrame / (this.frames.length - 1);
  }

  // --- Internal Methods ---

  _onFrame(timestamp) {
    if (!this.playing) return;

    const frameDuration = 1000 / (this.fps * this.speed);
    const elapsed = timestamp - this.lastFrameTime;

    if (elapsed >= frameDuration) {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      this._drawFrame(this.currentFrame);
      this.lastFrameTime = timestamp - (elapsed % frameDuration);
    }

    this.animationId = requestAnimationFrame(this._onFrame);
  }

  _drawFrame(frameIndex) {
    const frame = this.frames[frameIndex];
    if (!frame) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const landmarks = frame.landmarks;

    // Clear
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, w, h);

    // Compute bounding box of all visible landmarks across ALL frames
    // for consistent scaling (cached on first call)
    if (!this._bounds) {
      this._computeBounds();
    }

    const bounds = this._bounds;
    const pad = this.padding;
    const bw = bounds.maxX - bounds.minX || 1;
    const bh = bounds.maxY - bounds.minY || 1;

    // Scale to fit canvas with padding
    const scaleX = w * (1 - 2 * pad) / bw;
    const scaleY = h * (1 - 2 * pad) / bh;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (w - bw * scale) / 2;
    const offsetY = (h - bh * scale) / 2;

    const toCanvas = (lm) => {
      let x = (lm.x - bounds.minX) * scale + offsetX;
      const y = (lm.y - bounds.minY) * scale + offsetY;
      if (this.mirror) x = w - x;
      return { x, y, visibility: lm.visibility };
    };

    const points = landmarks.map(toCanvas);

    const connections = this.simplified
      ? SkeletonRenderer.CONNECTIONS_SIMPLE
      : SkeletonRenderer.CONNECTIONS;

    // Draw connections
    ctx.lineWidth = this.lineWidth;
    ctx.lineCap = 'round';

    for (const [i, j] of connections) {
      if (i >= points.length || j >= points.length) continue;
      const a = points[i];
      const b = points[j];

      const minVis = Math.min(a.visibility, b.visibility);
      if (minVis < 0.3) continue;

      ctx.strokeStyle = this.color;
      if (this.showConfidence) {
        ctx.globalAlpha = 0.3 + 0.7 * minVis;
      }

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    // Draw joints
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.visibility < 0.3) continue;

      // Skip face landmarks for cleaner look (indices 0-10)
      if (this.simplified && (i <= 10 || i >= 29)) continue;

      let radius = this.jointRadius;
      if (this.showConfidence) {
        ctx.globalAlpha = 0.3 + 0.7 * p.visibility;
        radius *= (0.5 + 0.5 * p.visibility);
      }

      ctx.fillStyle = this.jointColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  _computeBounds() {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    // Key body landmarks (skip face details for better framing)
    const bodyIndices = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

    for (const frame of this.frames) {
      for (const idx of bodyIndices) {
        if (idx >= frame.landmarks.length) continue;
        const lm = frame.landmarks[idx];
        if (lm.visibility < 0.3) continue;
        minX = Math.min(minX, lm.x);
        minY = Math.min(minY, lm.y);
        maxX = Math.max(maxX, lm.x);
        maxY = Math.max(maxY, lm.y);
        if (lm.z !== undefined) {
          minZ = Math.min(minZ, lm.z);
          maxZ = Math.max(maxZ, lm.z);
        }
      }
    }

    // Add some margin for head (above shoulders)
    const headMargin = (maxY - minY) * 0.25;
    minY = Math.max(0, minY - headMargin);

    // Add margin for feet (below ankles)
    const footMargin = (maxY - minY) * 0.05;
    maxY = Math.min(1, maxY + footMargin);

    // Fallback if no Z data found
    if (!isFinite(minZ)) { minZ = -0.5; maxZ = 0.5; }

    this._bounds = { minX, minY, maxX, maxY, minZ, maxZ };
  }

  /** Reset cached bounds (call after loading new data). */
  resetBounds() {
    this._bounds = null;
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SkeletonRenderer;
}
