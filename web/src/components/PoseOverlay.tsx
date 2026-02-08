"use client";

import { useEffect, useRef } from "react";
import type { LandmarkFrame, PoseLandmark, CoachingData } from "@/hooks/useExerciseWebSocket";

const POSE_CONNECTIONS: [number, number][] = [
  [11, 13], [13, 15], // Left arm
  [12, 14], [14, 16], // Right arm
  [11, 12],           // Shoulders
  [11, 23], [12, 24], // Torso sides
  [23, 24],           // Hips
  [23, 25], [25, 27], // Left leg
  [24, 26], [26, 28], // Right leg
];

// Only render major body joints (shoulders through ankles)
const BODY_INDICES = new Set([11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);

const VISIBILITY_THRESHOLD = 0.3;

// Accent color matching the app theme
const DOT_COLOR = "rgba(2, 202, 202, 0.9)";       // --color-primary with alpha
const DOT_GLOW = "rgba(2, 202, 202, 0.35)";
const LINE_COLOR = "rgba(2, 202, 202, 0.45)";

// Coaching arrow colors
const ARROW_COLOR = "rgba(255, 150, 0, 0.85)";
const ARROW_GLOW = "rgba(255, 150, 0, 0.3)";

// Map body part names to landmark indices for arrow drawing
const PART_TO_INDEX: Record<string, number> = {
  shoulder: 11,
  elbow: 13,
  wrist: 15,
  hip: 23,
  knee: 25,
  ankle: 27,
  foot: 31,
};

const SIDE_OFFSET: Record<string, number> = {
  left: 0,
  right: 1,
};

function partSideToIndex(part: string, side: string): number | null {
  const base = PART_TO_INDEX[part];
  if (base === undefined) return null;
  const offset = SIDE_OFFSET[side];
  if (offset === undefined) return base;
  return base + offset;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpLandmarks(
  prev: PoseLandmark[],
  curr: PoseLandmark[],
  t: number
): PoseLandmark[] {
  const clamped = Math.max(0, Math.min(1, t));
  const len = Math.min(prev.length, curr.length);
  const out: PoseLandmark[] = [];
  for (let i = 0; i < len; i++) {
    const pv = prev[i].visibility ?? 1;
    const cv = curr[i].visibility ?? 1;
    out.push({
      x: lerp(prev[i].x, curr[i].x, clamped),
      y: lerp(prev[i].y, curr[i].y, clamped),
      z: lerp(prev[i].z, curr[i].z, clamped),
      visibility: lerp(pv, cv, clamped),
    });
  }
  return out;
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
  dpr: number,
) {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return;

  const arrowLen = Math.min(len, 40 * dpr);
  const nx = dx / len;
  const ny = dy / len;
  const toX = fromX + nx * arrowLen;
  const toY = fromY + ny * arrowLen;

  const headLen = 8 * dpr;
  const headAngle = Math.PI / 6;
  const angle = Math.atan2(ny, nx);

  // Glow
  ctx.save();
  ctx.shadowColor = ARROW_GLOW;
  ctx.shadowBlur = 8 * dpr;

  ctx.strokeStyle = ARROW_COLOR;
  ctx.lineWidth = 2.5 * dpr;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLen * Math.cos(angle - headAngle),
    toY - headLen * Math.sin(angle - headAngle),
  );
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLen * Math.cos(angle + headAngle),
    toY - headLen * Math.sin(angle + headAngle),
  );
  ctx.stroke();

  ctx.restore();
}

interface PoseOverlayProps {
  landmarksRef: React.RefObject<LandmarkFrame>;
  coachingRef?: React.RefObject<CoachingData | null>;
  active: boolean;
}

export default function PoseOverlay({ landmarksRef, coachingRef, active }: PoseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    function draw() {
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      // Match canvas to parent element size (with DPR for sharpness)
      const parent = canvas!.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.round(rect.width * dpr);
      const ch = Math.round(rect.height * dpr);
      if (canvas!.width !== cw || canvas!.height !== ch) {
        canvas!.width = cw;
        canvas!.height = ch;
      }

      ctx.clearRect(0, 0, cw, ch);

      const frame = landmarksRef.current;
      if (!frame.current) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // Compute interpolation factor
      let landmarks: PoseLandmark[];
      if (frame.prev && frame.prevTime > 0) {
        const frameDuration = frame.currentTime - frame.prevTime;
        const elapsed = performance.now() - frame.currentTime;
        // Interpolate up to 1.0, then hold at current
        const t = frameDuration > 0 ? Math.min(elapsed / frameDuration, 1.5) : 1;
        landmarks = lerpLandmarks(frame.prev, frame.current, t);
      } else {
        landmarks = frame.current;
      }

      const w = cw;
      const h = ch;

      // Draw connections
      ctx.lineWidth = 3 * dpr;
      ctx.lineCap = "round";
      ctx.strokeStyle = LINE_COLOR;
      for (const [a, b] of POSE_CONNECTIONS) {
        if (a >= landmarks.length || b >= landmarks.length) continue;
        const la = landmarks[a];
        const lb = landmarks[b];
        if ((la.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;
        if ((lb.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;
        ctx.beginPath();
        ctx.moveTo(la.x * w, la.y * h);
        ctx.lineTo(lb.x * w, lb.y * h);
        ctx.stroke();
      }

      // Draw dots with glow (body joints only)
      const dotRadius = 5 * dpr;
      const glowRadius = 10 * dpr;
      for (let i = 0; i < landmarks.length; i++) {
        if (!BODY_INDICES.has(i)) continue;
        const lm = landmarks[i];
        if ((lm.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;
        const px = lm.x * w;
        const py = lm.y * h;

        // Glow
        ctx.beginPath();
        ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = DOT_GLOW;
        ctx.fill();

        // Solid dot
        ctx.beginPath();
        ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = DOT_COLOR;
        ctx.fill();
      }

      // Draw coaching correction arrows
      if (coachingRef?.current) {
        const coaching = coachingRef.current;
        for (const div of coaching.divergences) {
          if (div.distance < 0.04) continue; // Below threshold

          const idx = partSideToIndex(div.part, div.side);
          if (idx === null || idx >= landmarks.length) continue;
          const lm = landmarks[idx];
          if ((lm.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;

          const px = lm.x * w;
          const py = lm.y * h;

          // Scale divergence into pixel space.
          // Body-frame divergence ~0.04-0.4 maps to ~15-60px arrows.
          const scale = w * 0.6;
          const dx = -div.delta_x * scale; // Negate X because canvas is mirrored
          const dy = div.delta_y * scale;

          drawArrow(ctx, px, py, dx, dy, dpr);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, landmarksRef, coachingRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        transform: "scaleX(-1)", // mirror to match camera
        pointerEvents: "none",
        zIndex: 5,
      }}
    />
  );
}
