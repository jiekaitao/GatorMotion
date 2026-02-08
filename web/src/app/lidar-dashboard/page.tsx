"use client";

import { useLidarWebSocket } from "@/hooks/useLidarWebSocket";
import LidarSkeletonOverlay from "@/components/LidarSkeletonOverlay";

export default function LidarDashboardPage() {
  const { connected, frameRef, jointCount, depthCount, device, fps } =
    useLidarWebSocket();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#111",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "-apple-system, system-ui, sans-serif",
      }}
    >
      <h1 style={{ margin: "20px 0 10px", fontSize: 24 }}>
        GatorMotion LiDAR Dashboard
      </h1>

      <div
        style={{
          fontSize: 14,
          color: connected ? "#4ade80" : "#f87171",
          marginBottom: 10,
        }}
      >
        {connected ? "Connected" : "Connecting..."}
      </div>

      <div
        style={{
          position: "relative",
          width: 640,
          height: 480,
          maxWidth: "95vw",
        }}
      >
        <LidarSkeletonOverlay frameRef={frameRef} active={true} />
      </div>

      <div
        style={{
          margin: "16px 0",
          fontSize: 13,
          color: "#aaa",
          display: "flex",
          gap: 20,
        }}
      >
        <span>
          <span style={{ color: "#666" }}>FPS:</span> {fps}
        </span>
        <span>
          <span style={{ color: "#666" }}>Joints:</span> {jointCount}
        </span>
        <span>
          <span style={{ color: "#666" }}>Depth pts:</span> {depthCount}
        </span>
        <span>
          <span style={{ color: "#666" }}>Device:</span> {device}
        </span>
      </div>
    </div>
  );
}
