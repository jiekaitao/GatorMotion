"use client";

import { useRef, useEffect, useCallback } from "react";

// MediaPipe Pose 33-landmark connections (simplified: major joints only)
const CONNECTIONS = [
  [11, 12],           // shoulders
  [11, 23], [12, 24], // torso
  [23, 24],           // hips
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [23, 25], [25, 27], // left leg
  [24, 26], [26, 28], // right leg
];

// Key body landmark indices for bounding box computation
const BODY_INDICES = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility: number;
}

interface Frame {
  landmarks: Landmark[];
}

interface SkeletonData {
  exercise: string;
  fps: number;
  frames: Frame[];
}

interface SkeletonViewerProps {
  skeletonDataFile: string;
  playing?: boolean;
  speed?: number;
  mirror?: boolean;
  color?: string;
  backgroundColor?: string;
}

export default function SkeletonViewer({
  skeletonDataFile,
  playing = true,
  speed = 1.0,
  mirror = false,
  color = "#02caca",
  backgroundColor = "#1a1a2e",
}: SkeletonViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<SkeletonData | null>(null);
  const boundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const frameRef = useRef(0);
  const animIdRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const mirrorRef = useRef(mirror);

  // Keep refs synced
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { mirrorRef.current = mirror; }, [mirror]);

  const computeBounds = useCallback((frames: Frame[]) => {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const frame of frames) {
      for (const idx of BODY_INDICES) {
        if (idx >= frame.landmarks.length) continue;
        const lm = frame.landmarks[idx];
        if (lm.visibility < 0.3) continue;
        minX = Math.min(minX, lm.x);
        minY = Math.min(minY, lm.y);
        maxX = Math.max(maxX, lm.x);
        maxY = Math.max(maxY, lm.y);
      }
    }

    // Add head margin above shoulders
    const headMargin = (maxY - minY) * 0.25;
    minY = Math.max(0, minY - headMargin);
    // Add foot margin below ankles
    const footMargin = (maxY - minY) * 0.05;
    maxY = Math.min(1, maxY + footMargin);

    return { minX, minY, maxX, maxY };
  }, []);

  const drawFrame = useCallback((frameIndex: number) => {
    const canvas = canvasRef.current;
    const data = dataRef.current;
    const bounds = boundsRef.current;
    if (!canvas || !data || !bounds || frameIndex >= data.frames.length) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const frame = data.frames[frameIndex];
    const landmarks = frame.landmarks;
    const pad = 0.1;

    // Clear
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, w, h);

    const bw = bounds.maxX - bounds.minX || 1;
    const bh = bounds.maxY - bounds.minY || 1;
    const scaleX = w * (1 - 2 * pad) / bw;
    const scaleY = h * (1 - 2 * pad) / bh;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = (w - bw * scale) / 2;
    const offsetY = (h - bh * scale) / 2;

    const toCanvas = (lm: Landmark) => {
      let x = (lm.x - bounds.minX) * scale + offsetX;
      const y = (lm.y - bounds.minY) * scale + offsetY;
      if (mirrorRef.current) x = w - x;
      return { x, y, visibility: lm.visibility };
    };

    const points = landmarks.map(toCanvas);

    // Draw connections
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = color;

    for (const [i, j] of CONNECTIONS) {
      if (i >= points.length || j >= points.length) continue;
      const a = points[i];
      const b = points[j];
      if (Math.min(a.visibility, b.visibility) < 0.3) continue;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Draw joints
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.visibility < 0.3) continue;
      // Skip face landmarks (0-10) and foot details (29+)
      if (i <= 10 || i >= 29) continue;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [color, backgroundColor]);

  // Animation loop
  const animate = useCallback((timestamp: number) => {
    const data = dataRef.current;
    if (!data || data.frames.length === 0) return;

    if (playingRef.current) {
      const frameDuration = 1000 / ((data.fps || 30) * speedRef.current);
      const elapsed = timestamp - lastFrameTimeRef.current;

      if (elapsed >= frameDuration) {
        frameRef.current = (frameRef.current + 1) % data.frames.length;
        drawFrame(frameRef.current);
        lastFrameTimeRef.current = timestamp - (elapsed % frameDuration);
      }
    }

    animIdRef.current = requestAnimationFrame(animate);
  }, [drawFrame]);

  // Load skeleton data
  useEffect(() => {
    if (!skeletonDataFile) return;

    fetch(`/skeleton_data/${skeletonDataFile}`)
      .then((r) => r.json())
      .then((data: SkeletonData) => {
        dataRef.current = data;
        boundsRef.current = computeBounds(data.frames);
        frameRef.current = 0;
        lastFrameTimeRef.current = 0;
        drawFrame(0);

        // Start animation
        cancelAnimationFrame(animIdRef.current);
        animIdRef.current = requestAnimationFrame(animate);
      })
      .catch(() => {
        // Failed to load skeleton data
      });

    return () => {
      cancelAnimationFrame(animIdRef.current);
    };
  }, [skeletonDataFile, computeBounds, drawFrame, animate]);

  return (
    <div className="skeleton-viewer">
      <canvas
        ref={canvasRef}
        width={300}
        height={400}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "var(--radius-lg)",
        }}
      />
    </div>
  );
}
