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
  ear?: number;
  mar?: number;
}

export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface LandmarkFrame {
  prev: PoseLandmark[] | null;
  current: PoseLandmark[] | null;
  prevTime: number;
  currentTime: number;
}

interface UseExerciseWebSocketResult {
  connected: boolean;
  repCount: number;
  formQuality: string;
  painLevel: string;
  painMessage: string;
  ear: number;
  mar: number;
  angle: number;
  repState: string;
  landmarksRef: React.RefObject<LandmarkFrame>;
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
  const [ear, setEar] = useState(0);
  const [mar, setMar] = useState(0);
  const [angle, setAngle] = useState(0);
  const [repState, setRepState] = useState("waiting");

  const lastUiUpdateRef = useRef(0);
  const landmarksRef = useRef<LandmarkFrame>({
    prev: null,
    current: null,
    prevTime: 0,
    currentTime: 0,
  });

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

    const isSecure = window.location.protocol === "https:";
    const protocol = isSecure ? "wss:" : "ws:";
    const urls = [
      `${protocol}//${window.location.host}/ws/exercise?exercise=${exerciseKey}&detect=pose,face`,
      // Fallback to direct FastAPI port (only works on non-HTTPS / local dev)
      ...(!isSecure
        ? [`ws://${window.location.hostname}:8000/ws/exercise?exercise=${exerciseKey}&detect=pose,face`]
        : []),
    ];

    let stopped = false;
    let retryDelay = 1000;
    const MAX_RETRY_DELAY = 10000;

    function tryConnect() {
      if (stopped) return;

      let urlIdx = 0;

      function attemptUrl() {
        if (stopped || urlIdx >= urls.length) {
          // All URLs failed — schedule retry with backoff
          if (!stopped) {
            setTimeout(() => {
              retryDelay = Math.min(retryDelay * 1.5, MAX_RETRY_DELAY);
              tryConnect();
            }, retryDelay);
          }
          return;
        }

        const ws = new WebSocket(urls[urlIdx]);
        wsRef.current = ws;

        const timeout = setTimeout(() => ws.close(), 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          retryDelay = 1000; // reset backoff on success
          setConnected(true);
        };

        ws.onmessage = (event) => {
          pendingRef.current = false;
          const data = JSON.parse(event.data);

          const exercise: ExerciseStatus | undefined = data.exercise;
          const pain: PainStatus | undefined = data.pain;

          // Update landmark ref every frame (no React re-render)
          const pose: PoseLandmark[][] | undefined = data.pose;
          if (pose && pose.length > 0 && pose[0].length > 0) {
            const now = performance.now();
            landmarksRef.current = {
              prev: landmarksRef.current.current,
              current: pose[0],
              prevTime: landmarksRef.current.currentTime,
              currentTime: now,
            };
          }

          // Throttle React state updates to ~4/sec
          const now = performance.now();
          if (now - lastUiUpdateRef.current > 250) {
            if (exercise) {
              setRepCount(exercise.rep_count);
              setFormQuality(exercise.form_quality);
              setAngle(exercise.angle);
              setRepState(exercise.state);
            }
            if (pain) {
              setPainLevel(pain.level);
              setPainMessage(pain.message);
              if (pain.ear !== undefined) setEar(pain.ear);
              if (pain.mar !== undefined) setMar(pain.mar);
            }
            lastUiUpdateRef.current = now;
          }
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          setConnected(false);
          wsRef.current = null;
          // Reconnect after unexpected close (not during cleanup)
          if (!stopped) {
            setTimeout(tryConnect, retryDelay);
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          ws.close();
          urlIdx++;
          attemptUrl();
        };
      }

      attemptUrl();
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
    ear,
    mar,
    angle,
    repState,
    landmarksRef,
    startCapture,
    stopCapture,
  };
}
