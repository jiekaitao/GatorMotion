"use client";

import { useEffect, useRef } from "react";
import type { LandmarkFrame, PoseLandmark, CoachingData, RefLandmark } from "@/hooks/useExerciseWebSocket";

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

// Reference wireframe colors (debug mode)
const REF_DOT_COLOR = "rgba(234, 43, 43, 0.8)";
const REF_DOT_GLOW = "rgba(234, 43, 43, 0.25)";
const REF_LINE_COLOR = "rgba(234, 43, 43, 0.35)";

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

// Arrow thresholds
const ARROW_ACTIVATE_THRESHOLD = 0.12;   // Show arrow when divergence exceeds this
const ARROW_CLEAR_THRESHOLD = 0.06;      // Hide arrow when divergence drops below this
const DEBUG_ARROW_THRESHOLD = 0.005;     // Show everything in debug mode

// EMA smoothing for non-debug arrows
const EMA_ALPHA_CURRENT = 0.75;
const EMA_ALPHA_TARGET = 0.88;

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

// Color gradient based on divergence magnitude
function arrowColor(distance: number): string {
  // 0.0 - 0.10 green, 0.10 - 0.20 yellow, 0.20 - 0.35 orange, 0.35+ red
  if (distance < 0.10) return "rgba(88, 204, 2, 0.85)";
  if (distance < 0.20) return "rgba(255, 214, 0, 0.85)";
  if (distance < 0.35) return "rgba(255, 150, 0, 0.9)";
  return "rgba(234, 43, 43, 0.95)";
}

function arrowGlowColor(distance: number): string {
  if (distance < 0.10) return "rgba(88, 204, 2, 0.3)";
  if (distance < 0.20) return "rgba(255, 214, 0, 0.3)";
  if (distance < 0.35) return "rgba(255, 150, 0, 0.3)";
  return "rgba(234, 43, 43, 0.3)";
}

interface SmoothedArrow {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  distance: number;
  active: boolean;  // currently above activate threshold
  opacity: number;  // for fade in/out
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  dpr: number,
  color: string,
  glowColor: string,
  opacity: number,
  lineWidth: number,
) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return;

  const nx = dx / len;
  const ny = dy / len;
  const angle = Math.atan2(ny, nx);

  // Arrowhead: 24% of shaft length (experiment value)
  const headLen = Math.max(6 * dpr, len * 0.24);
  const headAngle = Math.PI / 6;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 8 * dpr;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Shaft
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
  debugMode?: boolean;
}

export default function PoseOverlay({ landmarksRef, coachingRef, active, debugMode = false }: PoseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  // Smoothed arrow state for non-debug mode (persists across frames)
  const smoothedArrowsRef = useRef<Map<string, SmoothedArrow>>(new Map());

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
        const t = frameDuration > 0 ? Math.min(elapsed / frameDuration, 1.5) : 1;
        landmarks = lerpLandmarks(frame.prev, frame.current, t);
      } else {
        landmarks = frame.current;
      }

      const w = cw;
      const h = ch;

      // ── Draw reference wireframe in debug mode ──
      if (debugMode && coachingRef?.current?.ref_landmarks) {
        const refLm = coachingRef.current.ref_landmarks;
        if (refLm.length >= 33) {
          drawWireframe(ctx, refLm, w, h, dpr, REF_LINE_COLOR, REF_DOT_COLOR, REF_DOT_GLOW, 2);
        }
      }

      // ── Draw user wireframe ──
      drawUserWireframe(ctx, landmarks, w, h, dpr);

      // ── Draw coaching correction arrows ──
      if (coachingRef?.current) {
        const coaching = coachingRef.current;
        if (debugMode) {
          drawDebugArrows(ctx, coaching, landmarks, w, h, dpr);
        } else {
          drawProductionArrows(ctx, coaching, landmarks, w, h, dpr, smoothedArrowsRef.current);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, landmarksRef, coachingRef, debugMode]);

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

/** Draw the user's pose wireframe (teal) */
function drawUserWireframe(
  ctx: CanvasRenderingContext2D,
  landmarks: PoseLandmark[],
  w: number,
  h: number,
  dpr: number,
) {
  // Connections
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

  // Dots with glow (body joints only)
  const dotRadius = 5 * dpr;
  const glowRadius = 10 * dpr;
  for (let i = 0; i < landmarks.length; i++) {
    if (!BODY_INDICES.has(i)) continue;
    const lm = landmarks[i];
    if ((lm.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;
    const px = lm.x * w;
    const py = lm.y * h;

    ctx.beginPath();
    ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = DOT_GLOW;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = DOT_COLOR;
    ctx.fill();
  }
}

/** Draw a wireframe from reference landmarks (for debug mode) */
function drawWireframe(
  ctx: CanvasRenderingContext2D,
  refLm: RefLandmark[],
  w: number,
  h: number,
  dpr: number,
  lineColor: string,
  dotColor: string,
  dotGlow: string,
  lineWidthBase: number,
) {
  // Connections
  ctx.lineWidth = lineWidthBase * dpr;
  ctx.lineCap = "round";
  ctx.strokeStyle = lineColor;
  for (const [a, b] of POSE_CONNECTIONS) {
    if (a >= refLm.length || b >= refLm.length) continue;
    const la = refLm[a];
    const lb = refLm[b];
    ctx.beginPath();
    ctx.moveTo(la.x * w, la.y * h);
    ctx.lineTo(lb.x * w, lb.y * h);
    ctx.stroke();
  }

  // Dots
  const dotRadius = 4 * dpr;
  const glowRadius = 8 * dpr;
  for (let i = 0; i < refLm.length; i++) {
    if (!BODY_INDICES.has(i)) continue;
    const lm = refLm[i];
    const px = lm.x * w;
    const py = lm.y * h;

    ctx.beginPath();
    ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = dotGlow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
  }
}

/** Debug mode: draw ALL arrows regardless of size, with color gradient */
function drawDebugArrows(
  ctx: CanvasRenderingContext2D,
  coaching: CoachingData,
  landmarks: PoseLandmark[],
  w: number,
  h: number,
  dpr: number,
) {
  for (const div of coaching.divergences) {
    if (div.distance < DEBUG_ARROW_THRESHOLD) continue;

    const idx = partSideToIndex(div.part, div.side);
    if (idx === null || idx >= landmarks.length) continue;
    const lm = landmarks[idx];
    if ((lm.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;

    const px = lm.x * w;
    const py = lm.y * h;

    // Scale divergence into pixel space — proportional to divergence magnitude
    const scale = w * 0.6;
    const dx = -div.delta_x * scale; // Negate X because canvas is mirrored
    const dy = div.delta_y * scale;

    const toX = px + dx;
    const toY = py + dy;

    const color = arrowColor(div.distance);
    const glow = arrowGlowColor(div.distance);
    const thickness = (2 + Math.min(div.distance * 8, 3)) * dpr;

    drawArrow(ctx, px, py, toX, toY, dpr, color, glow, 1.0, thickness);
  }
}

/** Non-debug mode: only large arrows with EMA smoothing and hysteresis */
function drawProductionArrows(
  ctx: CanvasRenderingContext2D,
  coaching: CoachingData,
  landmarks: PoseLandmark[],
  w: number,
  h: number,
  dpr: number,
  smoothed: Map<string, SmoothedArrow>,
) {
  const scale = w * 0.6;
  const seenKeys = new Set<string>();

  for (const div of coaching.divergences) {
    const key = `${div.side}_${div.part}`;
    seenKeys.add(key);

    const idx = partSideToIndex(div.part, div.side);
    if (idx === null || idx >= landmarks.length) continue;
    const lm = landmarks[idx];
    if ((lm.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;

    const rawFromX = lm.x * w;
    const rawFromY = lm.y * h;
    const rawToX = rawFromX + (-div.delta_x * scale);
    const rawToY = rawFromY + (div.delta_y * scale);

    const existing = smoothed.get(key);

    if (existing) {
      // EMA smooth the positions
      existing.fromX = lerp(existing.fromX, rawFromX, EMA_ALPHA_CURRENT);
      existing.fromY = lerp(existing.fromY, rawFromY, EMA_ALPHA_CURRENT);
      existing.toX = lerp(existing.toX, rawToX, EMA_ALPHA_TARGET);
      existing.toY = lerp(existing.toY, rawToY, EMA_ALPHA_TARGET);
      existing.distance = lerp(existing.distance, div.distance, 0.3);

      // Hysteresis: activate at high threshold, deactivate at low
      if (!existing.active && div.distance > ARROW_ACTIVATE_THRESHOLD) {
        existing.active = true;
      } else if (existing.active && div.distance < ARROW_CLEAR_THRESHOLD) {
        existing.active = false;
      }

      // Animate opacity
      if (existing.active) {
        existing.opacity = Math.min(1.0, existing.opacity + 0.08);
      } else {
        existing.opacity = Math.max(0, existing.opacity - 0.04);
      }
    } else {
      // New arrow — only create if above activate threshold
      const isActive = div.distance > ARROW_ACTIVATE_THRESHOLD;
      smoothed.set(key, {
        fromX: rawFromX,
        fromY: rawFromY,
        toX: rawToX,
        toY: rawToY,
        distance: div.distance,
        active: isActive,
        opacity: isActive ? 0.3 : 0, // start partially visible if active
      });
    }
  }

  // Fade out arrows for joints no longer reported
  for (const [key, arrow] of smoothed) {
    if (!seenKeys.has(key)) {
      arrow.active = false;
      arrow.opacity = Math.max(0, arrow.opacity - 0.04);
      if (arrow.opacity <= 0) {
        smoothed.delete(key);
      }
    }
  }

  // Draw all visible arrows
  for (const arrow of smoothed.values()) {
    if (arrow.opacity <= 0.01) continue;

    const color = arrowColor(arrow.distance);
    const glow = arrowGlowColor(arrow.distance);
    const thickness = (2.5 + Math.min(arrow.distance * 6, 2.5)) * dpr;

    drawArrow(ctx, arrow.fromX, arrow.fromY, arrow.toX, arrow.toY, dpr, color, glow, arrow.opacity, thickness);
  }
}
