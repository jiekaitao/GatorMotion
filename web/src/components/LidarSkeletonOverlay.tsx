"use client";

import { useEffect, useRef } from "react";
import type { LidarFrame } from "@/hooks/useLidarWebSocket";

interface LidarSkeletonOverlayProps {
  frameRef: React.RefObject<LidarFrame | null>;
  active: boolean;
}

export default function LidarSkeletonOverlay({
  frameRef,
  active,
}: LidarSkeletonOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    function draw() {
      const ctx = canvas!.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const frame = frameRef.current;
      const cw = frame?.camera_width || 640;
      const ch = frame?.camera_height || 480;

      if (canvas!.width !== cw || canvas!.height !== ch) {
        canvas!.width = cw;
        canvas!.height = ch;
      }

      ctx.clearRect(0, 0, cw, ch);

      if (!frame) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const parts = frame.body_part_depths || [];
      const byId = new Map<number, (typeof parts)[0]>();
      parts.forEach((p) => byId.set(p.landmark_id, p));

      const conns = frame.connections || [];

      // Draw connections
      ctx.strokeStyle = "rgba(0, 255, 0, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [s, e] of conns) {
        const sp = byId.get(s);
        const ep = byId.get(e);
        if (!sp || !ep) continue;
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(ep.x, ep.y);
      }
      ctx.stroke();

      // Draw joints
      ctx.fillStyle = "#facc15";
      for (const p of parts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw labels
      ctx.font = "10px monospace";
      for (const p of parts) {
        const label =
          p.name +
          (p.distance_cm > 0 ? " " + p.distance_cm.toFixed(0) + "cm" : "");
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(p.x + 6, p.y - 10, tw + 4, 14);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, p.x + 8, p.y);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, frameRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        background: "#000",
        borderRadius: 8,
      }}
    />
  );
}
