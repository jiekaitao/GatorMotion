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

// User wireframe colors (teal — matching SkeletonViewer #02caca)
const DOT_COLOR = "rgba(2, 202, 202, 0.9)";
const DOT_GLOW = "rgba(2, 202, 202, 0.35)";
const LINE_COLOR = "rgba(2, 202, 202, 0.45)";

// Reference wireframe colors (red, debug mode only)
const REF_DOT_COLOR = "rgba(234, 43, 43, 0.8)";
const REF_DOT_GLOW = "rgba(234, 43, 43, 0.25)";
const REF_LINE_COLOR = "rgba(234, 43, 43, 0.35)";

// Map body part names to MediaPipe landmark indices
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

// Arrow thresholds (matching experiment live_coach_v2.py)
const ARROW_ACTIVATE_THRESHOLD = 0.12;   // Show arrow when divergence exceeds this
const ARROW_CLEAR_THRESHOLD = 0.06;      // Hide arrow when divergence drops below this

// EMA smoothing — experiment uses: smoothed = alpha*prev + (1-alpha)*current
// Our lerp(a, b, t) = a + t*(b-a) = (1-t)*a + t*b
// So lerp(prev, current, 1-alpha) matches the experiment
const EMA_LERP_CURRENT = 0.25;  // 1 - 0.75 from experiment
const EMA_LERP_TARGET = 0.12;   // 1 - 0.88 from experiment

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

function lerpRefLandmarks(
  prev: RefLandmark[],
  curr: RefLandmark[],
  t: number
): RefLandmark[] {
  const clamped = Math.max(0, Math.min(1, t));
  const len = Math.min(prev.length, curr.length);
  const out: RefLandmark[] = [];
  for (let i = 0; i < len; i++) {
    out.push({
      x: lerp(prev[i].x, curr[i].x, clamped),
      y: lerp(prev[i].y, curr[i].y, clamped),
    });
  }
  return out;
}

// Color gradient based on divergence magnitude (matching experiment severity)
function arrowColor(distance: number): string {
  if (distance < 0.10) return "rgba(80, 190, 255, 0.85)";    // low (light blue)
  if (distance < 0.20) return "rgba(0, 190, 255, 0.85)";     // medium (cyan)
  if (distance < 0.35) return "rgba(255, 150, 0, 0.9)";      // high (orange)
  return "rgba(234, 43, 43, 0.95)";                           // very high (red)
}

function arrowGlowColor(distance: number): string {
  if (distance < 0.10) return "rgba(80, 190, 255, 0.3)";
  if (distance < 0.20) return "rgba(0, 190, 255, 0.3)";
  if (distance < 0.35) return "rgba(255, 150, 0, 0.3)";
  return "rgba(234, 43, 43, 0.3)";
}

interface SmoothedArrow {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  distance: number;
  active: boolean;
  opacity: number;
}

/** Ref-landmark frame interpolation state */
interface RefFrame {
  prev: RefLandmark[] | null;
  current: RefLandmark[] | null;
  prevTime: number;
  currentTime: number;
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

  const angle = Math.atan2(dy, dx);

  // Arrowhead: 24% of shaft length (experiment value)
  const headLen = Math.max(6 * dpr, len * 0.24);
  const headAngle = Math.PI / 6;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 6 * dpr;

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

  // Small circle at origin (experiment: 6px radius)
  ctx.beginPath();
  ctx.arc(fromX, fromY, 4 * dpr, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke();

  ctx.restore();
}

export interface OverlayToggles {
  showUserWireframe: boolean;
  showRefWireframe: boolean;
  showArrows: boolean;
}

interface PoseOverlayProps {
  landmarksRef: React.RefObject<LandmarkFrame>;
  coachingRef?: React.RefObject<CoachingData | null>;
  active: boolean;
  debugMode?: boolean;
  overlayToggles?: OverlayToggles;
}

export default function PoseOverlay({
  landmarksRef,
  coachingRef,
  active,
  debugMode = false,
  overlayToggles,
}: PoseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  // Smoothed arrow state for non-debug mode (persists across frames)
  const smoothedArrowsRef = useRef<Map<string, SmoothedArrow>>(new Map());

  // Ref-landmark frame interpolation state (like landmarksRef but for reference)
  const refFrameRef = useRef<RefFrame>({
    prev: null,
    current: null,
    prevTime: 0,
    currentTime: 0,
  });

  // Track last coaching ref_landmarks identity to detect new frames
  const lastRefLandmarksRef = useRef<RefLandmark[] | undefined>(undefined);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Determine what to show
    const showUser = overlayToggles ? overlayToggles.showUserWireframe : true;
    const showRef = overlayToggles ? overlayToggles.showRefWireframe : debugMode;
    const showArrows = overlayToggles ? overlayToggles.showArrows : true;

    function draw() {
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

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

      // Interpolate user landmarks
      let landmarks: PoseLandmark[];
      if (frame.prev && frame.prevTime > 0) {
        const frameDuration = frame.currentTime - frame.prevTime;
        const elapsed = performance.now() - frame.currentTime;
        const t = frameDuration > 0 ? Math.min(elapsed / frameDuration, 1.5) : 1;
        landmarks = lerpLandmarks(frame.prev, frame.current, t);
      } else {
        landmarks = frame.current;
      }

      // Track ref_landmarks changes for interpolation
      const coaching = coachingRef?.current;
      if (coaching?.ref_landmarks && coaching.ref_landmarks !== lastRefLandmarksRef.current) {
        const rf = refFrameRef.current;
        rf.prev = rf.current;
        rf.current = coaching.ref_landmarks;
        rf.prevTime = rf.currentTime;
        rf.currentTime = performance.now();
        lastRefLandmarksRef.current = coaching.ref_landmarks;
      }

      // Interpolate ref landmarks
      let refLandmarks: RefLandmark[] | null = null;
      const rf = refFrameRef.current;
      if (rf.current) {
        if (rf.prev && rf.prevTime > 0) {
          const frameDuration = rf.currentTime - rf.prevTime;
          const elapsed = performance.now() - rf.currentTime;
          const t = frameDuration > 0 ? Math.min(elapsed / frameDuration, 1.5) : 1;
          refLandmarks = lerpRefLandmarks(rf.prev, rf.current, t);
        } else {
          refLandmarks = rf.current;
        }
      }

      const w = cw;
      const h = ch;

      // Draw reference wireframe (debug mode or toggled on)
      if (showRef && refLandmarks && refLandmarks.length >= 33) {
        drawWireframe(ctx, refLandmarks, w, h, dpr, REF_LINE_COLOR, REF_DOT_COLOR, REF_DOT_GLOW, 2);
      }

      // Draw user wireframe
      if (showUser) {
        drawUserWireframe(ctx, landmarks, w, h, dpr);
      }

      // Draw correction arrows
      if (showArrows && coaching && refLandmarks && refLandmarks.length >= 33) {
        if (debugMode) {
          drawDebugArrows(ctx, coaching, landmarks, refLandmarks, w, h, dpr);
        } else {
          drawProductionArrows(ctx, coaching, landmarks, refLandmarks, w, h, dpr, smoothedArrowsRef.current);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, landmarksRef, coachingRef, debugMode, overlayToggles]);

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

/** Draw a wireframe from reference landmarks (for debug mode, in red) */
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
  ctx.lineWidth = lineWidthBase * dpr;
  ctx.lineCap = "round";
  ctx.strokeStyle = lineColor;
  for (const [a, b] of POSE_CONNECTIONS) {
    if (a >= refLm.length || b >= refLm.length) continue;
    ctx.beginPath();
    ctx.moveTo(refLm[a].x * w, refLm[a].y * h);
    ctx.lineTo(refLm[b].x * w, refLm[b].y * h);
    ctx.stroke();
  }

  const dotRadius = 4 * dpr;
  const glowRadius = 8 * dpr;
  for (let i = 0; i < refLm.length; i++) {
    if (!BODY_INDICES.has(i)) continue;
    const px = refLm[i].x * w;
    const py = refLm[i].y * h;

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

/**
 * Debug mode: draw ALL arrows from user landmark to reference landmark.
 * Uses image-space positions directly (matching experiment approach).
 */
function drawDebugArrows(
  ctx: CanvasRenderingContext2D,
  coaching: CoachingData,
  landmarks: PoseLandmark[],
  refLm: RefLandmark[],
  w: number,
  h: number,
  dpr: number,
) {
  for (const div of coaching.divergences) {
    if (div.distance < 0.005) continue;

    const idx = partSideToIndex(div.part, div.side);
    if (idx === null || idx >= landmarks.length || idx >= refLm.length) continue;
    const lm = landmarks[idx];
    if ((lm.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;

    // Arrow FROM user position TO reference position (in pixel space)
    const fromX = lm.x * w;
    const fromY = lm.y * h;
    const toX = refLm[idx].x * w;
    const toY = refLm[idx].y * h;

    const color = arrowColor(div.distance);
    const glow = arrowGlowColor(div.distance);
    const thickness = (2 + Math.min(div.distance * 4, 2)) * dpr;

    drawArrow(ctx, fromX, fromY, toX, toY, dpr, color, glow, 1.0, thickness);
  }
}

/**
 * Non-debug mode: only large arrows with EMA smoothing and hysteresis.
 * Arrow endpoints are the user landmark and reference landmark positions
 * in image space, matching the experiment approach.
 */
function drawProductionArrows(
  ctx: CanvasRenderingContext2D,
  coaching: CoachingData,
  landmarks: PoseLandmark[],
  refLm: RefLandmark[],
  w: number,
  h: number,
  dpr: number,
  smoothed: Map<string, SmoothedArrow>,
) {
  const seenKeys = new Set<string>();

  for (const div of coaching.divergences) {
    const key = `${div.side}_${div.part}`;
    seenKeys.add(key);

    const idx = partSideToIndex(div.part, div.side);
    if (idx === null || idx >= landmarks.length || idx >= refLm.length) continue;
    const lm = landmarks[idx];
    if ((lm.visibility ?? 1) < VISIBILITY_THRESHOLD) continue;

    // Image-space positions
    const rawFromX = lm.x * w;
    const rawFromY = lm.y * h;
    const rawToX = refLm[idx].x * w;
    const rawToY = refLm[idx].y * h;

    const existing = smoothed.get(key);

    if (existing) {
      // EMA smooth: smoothed = alpha*prev + (1-alpha)*current
      // Using lerp(prev, current, 1-alpha) to match experiment
      existing.fromX = lerp(existing.fromX, rawFromX, EMA_LERP_CURRENT);
      existing.fromY = lerp(existing.fromY, rawFromY, EMA_LERP_CURRENT);
      existing.toX = lerp(existing.toX, rawToX, EMA_LERP_TARGET);
      existing.toY = lerp(existing.toY, rawToY, EMA_LERP_TARGET);
      existing.distance = lerp(existing.distance, div.distance, 0.15);

      // Hysteresis: activate at high threshold, deactivate at low
      if (!existing.active && div.distance > ARROW_ACTIVATE_THRESHOLD) {
        existing.active = true;
      } else if (existing.active && div.distance < ARROW_CLEAR_THRESHOLD) {
        existing.active = false;
      }

      // Animate opacity
      if (existing.active) {
        existing.opacity = Math.min(1.0, existing.opacity + 0.06);
      } else {
        existing.opacity = Math.max(0, existing.opacity - 0.03);
      }
    } else {
      const isActive = div.distance > ARROW_ACTIVATE_THRESHOLD;
      smoothed.set(key, {
        fromX: rawFromX,
        fromY: rawFromY,
        toX: rawToX,
        toY: rawToY,
        distance: div.distance,
        active: isActive,
        opacity: isActive ? 0.2 : 0,
      });
    }
  }

  // Fade out arrows for joints no longer reported
  for (const [key, arrow] of smoothed) {
    if (!seenKeys.has(key)) {
      arrow.active = false;
      arrow.opacity = Math.max(0, arrow.opacity - 0.03);
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
    const thickness = (2 + Math.min(arrow.distance * 4, 2)) * dpr;

    drawArrow(ctx, arrow.fromX, arrow.fromY, arrow.toX, arrow.toY, dpr, color, glow, arrow.opacity, thickness);
  }
}
