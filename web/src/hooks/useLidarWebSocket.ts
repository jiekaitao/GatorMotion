"use client";

import { useEffect, useRef, useState } from "react";

export interface BodyPart {
  landmark_id: number;
  name: string;
  x: number;
  y: number;
  depth: number;
  distance_cm: number;
}

export interface LidarFrame {
  device: string;
  timestamp: number;
  exercise: string;
  depth_mode: string;
  joints: Record<string, [number, number, number]>;
  keypoints_2d: Record<string, [number, number]>;
  point_depths_m: Record<string, number>;
  body_part_depths: BodyPart[];
  camera_width: number;
  camera_height: number;
  connections: [number, number][];
}

interface UseLidarWebSocketResult {
  connected: boolean;
  frameRef: React.RefObject<LidarFrame | null>;
  jointCount: number;
  depthCount: number;
  device: string;
  fps: number;
}

export function useLidarWebSocket(): UseLidarWebSocketResult {
  const wsRef = useRef<WebSocket | null>(null);
  const frameRef = useRef<LidarFrame | null>(null);

  const [connected, setConnected] = useState(false);
  const [jointCount, setJointCount] = useState(0);
  const [depthCount, setDepthCount] = useState(0);
  const [device, setDevice] = useState("-");
  const [fps, setFps] = useState(0);

  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(Date.now());
  const lastUiUpdateRef = useRef(0);

  useEffect(() => {
    let stopped = false;

    function connect() {
      if (stopped) return;

      const isSecure = window.location.protocol === "https:";
      const protocol = isSecure ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/ws/lidar/dashboard`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        const data: LidarFrame = JSON.parse(event.data);
        frameRef.current = data;

        frameCountRef.current++;
        const now = Date.now();
        if (now - lastFpsTimeRef.current > 1000) {
          setFps(frameCountRef.current);
          frameCountRef.current = 0;
          lastFpsTimeRef.current = now;
        }

        // Throttle React state updates to ~4/sec
        const uiNow = performance.now();
        if (uiNow - lastUiUpdateRef.current > 250) {
          setJointCount(data.body_part_depths?.length ?? 0);
          setDepthCount(Object.keys(data.point_depths_m ?? {}).length);
          setDevice(data.device || "-");
          lastUiUpdateRef.current = uiNow;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!stopped) {
          setTimeout(connect, 1000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      stopped = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, []);

  return { connected, frameRef, jointCount, depthCount, device, fps };
}
