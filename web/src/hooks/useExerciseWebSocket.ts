"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const CAPTURE_W = 320;
const CAPTURE_H = 240;

interface ExerciseStatus {
  rep_count: number;
  angle: number;
  state: string;
  form_quality: string;
  name: string;
}

interface PainStatus {
  level: string;
  message: string;
}

interface UseExerciseWebSocketResult {
  connected: boolean;
  repCount: number;
  formQuality: string;
  painLevel: string;
  painMessage: string;
  startCapture: (videoElement: HTMLVideoElement) => void;
  stopCapture: () => void;
}

export function useExerciseWebSocket(exerciseKey: string | null): UseExerciseWebSocketResult {
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef(0);
  const pendingRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [repCount, setRepCount] = useState(0);
  const [formQuality, setFormQuality] = useState("neutral");
  const [painLevel, setPainLevel] = useState("normal");
  const [painMessage, setPainMessage] = useState("");

  const lastUiUpdateRef = useRef(0);

  // Send a single frame
  const sendFrame = useCallback(() => {
    const video = videoRef.current;
    const ws = wsRef.current;
    if (!video || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (pendingRef.current) return;
    if (video.paused || video.ended || !video.videoWidth) return;

    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement("canvas");
    }
    const canvas = captureCanvasRef.current;
    canvas.width = CAPTURE_W;
    canvas.height = CAPTURE_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, CAPTURE_W, CAPTURE_H);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
    const base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
    pendingRef.current = true;
    ws.send(base64);
  }, []);

  // Connect WebSocket
  useEffect(() => {
    if (!exerciseKey) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const urls = [
      `${protocol}//${window.location.host}/ws/exercise?exercise=${exerciseKey}&detect=pose,face`,
      `ws://${window.location.hostname}:8000/ws/exercise?exercise=${exerciseKey}&detect=pose,face`,
    ];

    let urlIdx = 0;
    let stopped = false;

    function tryConnect() {
      if (stopped || urlIdx >= urls.length) return;

      const ws = new WebSocket(urls[urlIdx]);
      wsRef.current = ws;

      const timeout = setTimeout(() => ws.close(), 3000);

      ws.onopen = () => {
        clearTimeout(timeout);
        setConnected(true);
      };

      ws.onmessage = (event) => {
        pendingRef.current = false;
        const data = JSON.parse(event.data);

        const exercise: ExerciseStatus | undefined = data.exercise;
        const pain: PainStatus | undefined = data.pain;

        // Throttle React state updates to ~4/sec
        const now = performance.now();
        if (now - lastUiUpdateRef.current > 250) {
          if (exercise) {
            setRepCount(exercise.rep_count);
            setFormQuality(exercise.form_quality);
          }
          if (pain) {
            setPainLevel(pain.level);
            setPainMessage(pain.message);
          }
          lastUiUpdateRef.current = now;
        }
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        setConnected(false);
        wsRef.current = null;
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        ws.close();
        urlIdx++;
        tryConnect();
      };
    }

    tryConnect();

    return () => {
      stopped = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [exerciseKey]);

  // Animation loop for frame capture
  useEffect(() => {
    if (!connected || !exerciseKey) return;

    function loop() {
      sendFrame();
      animFrameRef.current = requestAnimationFrame(loop);
    }
    animFrameRef.current = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [connected, exerciseKey, sendFrame]);

  const startCapture = useCallback((videoElement: HTMLVideoElement) => {
    videoRef.current = videoElement;
  }, []);

  const stopCapture = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    videoRef.current = null;
  }, []);

  return {
    connected,
    repCount,
    formQuality,
    painLevel,
    painMessage,
    startCapture,
    stopCapture,
  };
}
