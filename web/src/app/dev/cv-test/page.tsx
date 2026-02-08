"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
  Camera,
  Film,
  Upload,
  Square,
} from "lucide-react";

interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  label?: string;
}

interface TrackingResult {
  pose: PoseLandmark[][];
  hands: PoseLandmark[][];
  handedness: (string | null)[];
  face: PoseLandmark[][];
}

const POSE_CONNECTIONS = [
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 12],
  [11, 23], [12, 24],
  [23, 24],
  [23, 25], [25, 27],
  [24, 26], [26, 28],
  [0, 7], [0, 8],
];

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

const CAPTURE_W = 320;
const CAPTURE_H = 240;

type Mode = "webcam" | "video" | null;

export default function DevCvTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const animFrameRef = useRef<number>(0);
  const pendingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef(false);

  const [mode, setMode] = useState<Mode>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [displayResult, setDisplayResult] = useState<TrackingResult | null>(null);

  const fpsCountRef = useRef(0);
  const fpsTimerRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  // ── Draw skeleton overlay ──────────────────────────────────────
  const drawOverlay = useCallback((result: TrackingResult) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const vw = video.videoWidth || video.clientWidth;
    const vh = video.videoHeight || video.clientHeight;
    // Only reset canvas dimensions when they change (avoids expensive reflow)
    if (canvasSizeRef.current.w !== vw || canvasSizeRef.current.h !== vh) {
      canvas.width = vw;
      canvas.height = vh;
      canvasSizeRef.current = { w: vw, h: vh };
    }
    const w = vw;
    const h = vh;
    const mirrored = mirrorRef.current;

    ctx.clearRect(0, 0, w, h);

    // Pose
    if (result.pose.length > 0) {
      const pose = result.pose[0];

      ctx.strokeStyle = "#00FF88";
      ctx.lineWidth = 3;
      for (const [a, b] of POSE_CONNECTIONS) {
        if (a < pose.length && b < pose.length) {
          const la = pose[a];
          const lb = pose[b];
          if ((la.visibility ?? 1) > 0.3 && (lb.visibility ?? 1) > 0.3) {
            ctx.beginPath();
            ctx.moveTo(la.x * w, la.y * h);
            ctx.lineTo(lb.x * w, lb.y * h);
            ctx.stroke();
          }
        }
      }

      for (const lm of pose) {
        if ((lm.visibility ?? 1) > 0.3) {
          ctx.beginPath();
          ctx.arc(lm.x * w, lm.y * h, 5, 0, Math.PI * 2);
          ctx.fillStyle = lm.label ? "#00FFAA" : "#00FF88";
          ctx.fill();
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Labels
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "left";
      for (const lm of pose) {
        if (lm.label && (lm.visibility ?? 1) > 0.3) {
          const px = lm.x * w;
          const py = lm.y * h;
          const m = ctx.measureText(lm.label);

          if (mirrored) {
            ctx.save();
            ctx.translate(px, py);
            ctx.scale(-1, 1);
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillRect(6, -16, m.width + 4, 14);
            ctx.fillStyle = "#FFF";
            ctx.fillText(lm.label, 8, -6);
            ctx.restore();
          } else {
            const x = px + 8;
            const y = py - 6;
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillRect(x - 2, y - 10, m.width + 4, 14);
            ctx.fillStyle = "#FFF";
            ctx.fillText(lm.label, x, y);
          }
        }
      }
    }

    // Hands
    const handColors = ["#FF6B6B", "#6B9FFF"];
    for (let hi = 0; hi < result.hands.length; hi++) {
      const hand = result.hands[hi];
      const color = handColors[hi % 2];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      for (const [a, b] of HAND_CONNECTIONS) {
        if (a < hand.length && b < hand.length) {
          ctx.beginPath();
          ctx.moveTo(hand[a].x * w, hand[a].y * h);
          ctx.lineTo(hand[b].x * w, hand[b].y * h);
          ctx.stroke();
        }
      }
      for (const lm of hand) {
        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }

    // Face
    if (result.face.length > 0) {
      const face = result.face[0];
      ctx.fillStyle = "rgba(168,130,255,0.4)";
      for (const lm of face) {
        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, []);

  // ── Teardown helpers (no state, just refs) ─────────────────────
  function teardown() {
    cancelAnimationFrame(animFrameRef.current);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute("src");
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    pendingRef.current = false;
  }

  // ── WebSocket with fallback URLs ────────────────────────────────
  function openWs() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const urls = [
      `${protocol}//${window.location.host}/ws/track`,
      `ws://${window.location.hostname}:8000/ws/track`,
    ];

    let urlIdx = 0;

    function tryConnect() {
      if (urlIdx >= urls.length) {
        setError("WebSocket connection failed. Is the CV backend running?");
        return;
      }
      const ws = new WebSocket(urls[urlIdx]);
      wsRef.current = ws;

      const timeout = setTimeout(() => { ws.close(); }, 3000);

      ws.onopen = () => {
        clearTimeout(timeout);
        setWsConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        pendingRef.current = false;
        const result: TrackingResult = JSON.parse(event.data);

        // Draw overlay every frame (no React re-render)
        drawOverlay(result);

        // Throttle React state updates to ~2/sec for the stats panel
        const now = performance.now();
        fpsCountRef.current++;
        if (now - fpsTimerRef.current > 1000) {
          setFps(fpsCountRef.current);
          fpsCountRef.current = 0;
          fpsTimerRef.current = now;
        }
        if (now - lastUiUpdateRef.current > 500) {
          setDisplayResult(result);
          lastUiUpdateRef.current = now;
        }
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        setWsConnected(false);
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
  }

  // ── Send frame ─────────────────────────────────────────────────
  const sendFrame = useCallback(() => {
    const video = videoRef.current;
    const captureCanvas = captureCanvasRef.current;
    const ws = wsRef.current;
    if (!video || !captureCanvas || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (pendingRef.current) return;
    if (video.paused || video.ended || !video.videoWidth) return;

    captureCanvas.width = CAPTURE_W;
    captureCanvas.height = CAPTURE_H;
    const ctx = captureCanvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, CAPTURE_W, CAPTURE_H);
    const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.5);
    const base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
    pendingRef.current = true;
    ws.send(base64);
  }, []);

  // ── Animation loop ─────────────────────────────────────────────
  useEffect(() => {
    if (!mode || !wsConnected) return;

    function loop() {
      sendFrame();
      animFrameRef.current = requestAnimationFrame(loop);
    }
    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [mode, wsConnected, sendFrame]);

  // ── Start webcam ───────────────────────────────────────────────
  async function startWebcam() {
    teardown();
    setMode(null);
    setWsConnected(false);
    setDisplayResult(null);
    setFps(0);
    setError(null);
    mirrorRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        v.loop = false;
        await v.play();
      }
      setMode("webcam");
      openWs();
    } catch {
      setError("Camera access denied. Please allow camera permissions.");
    }
  }

  // ── Start video ────────────────────────────────────────────────
  async function startVideo(src: string) {
    teardown();
    setMode(null);
    setWsConnected(false);
    setDisplayResult(null);
    setFps(0);
    setError(null);
    mirrorRef.current = false;

    const v = videoRef.current;
    if (v) {
      v.srcObject = null;
      v.src = src;
      v.loop = true;
      try {
        await v.play();
      } catch {
        // autoplay may require user gesture, that's ok — video will show first frame
      }
    }
    setMode("video");
    openWs();
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    startVideo(url);
  }

  // ── Stop ───────────────────────────────────────────────────────
  function stopAll() {
    teardown();
    setMode(null);
    setWsConnected(false);
    setDisplayResult(null);
    setFps(0);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => teardown();
  }, []);

  const running = mode !== null;
  const mirrored = mode === "webcam";
  const poseCount = displayResult?.pose?.[0]?.length ?? 0;
  const handCount = displayResult?.hands?.length ?? 0;
  const faceCount = displayResult?.face?.[0]?.length ?? 0;

  return (
    <div className="page">
      <Link
        href="/dev"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          color: "var(--color-gray-400)",
          textDecoration: "none",
          fontSize: "var(--text-small)",
          fontWeight: 600,
          marginBottom: "var(--space-sm)",
        }}
      >
        <ChevronLeft size={18} /> Back to Dev Panel
      </Link>
      <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-md)" }}>
        Dev: CV Test
      </h1>
      <div className="badge badge-orange animate-in" style={{ marginBottom: "var(--space-lg)" }}>
        Development Only
      </div>

      {/* Controls + Status */}
      <div
        className="card animate-in"
        style={{
          marginBottom: "var(--space-md)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-md)",
        }}
      >
        {/* Source buttons */}
        <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            onClick={startWebcam}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <Camera size={16} />
            Webcam
          </button>

          <button
            className="btn btn-secondary"
            onClick={() => startVideo("/sample-exercise.mp4")}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <Film size={16} />
            Sample Video
          </button>

          <button
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <Upload size={16} />
            Upload Video
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileUpload}
            style={{ display: "none" }}
          />

          {running && (
            <button
              className="btn btn-danger"
              onClick={stopAll}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <Square size={16} />
              Stop
            </button>
          )}
        </div>

        {/* Status row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-sm)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {running ? <Video size={16} color="var(--color-primary)" /> : <VideoOff size={16} color="var(--color-gray-300)" />}
              <span className="text-small" style={{ fontWeight: 600, color: running ? "var(--color-primary-dark)" : "var(--color-gray-400)" }}>
                {mode === "webcam" ? "Camera" : mode === "video" ? "Video" : "Off"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {wsConnected ? <Wifi size={16} color="var(--color-primary)" /> : <WifiOff size={16} color="var(--color-gray-300)" />}
              <span className="text-small" style={{ fontWeight: 600, color: wsConnected ? "var(--color-primary-dark)" : "var(--color-gray-400)" }}>
                {wsConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
          {running && (
            <span className="text-tiny" style={{ color: "var(--color-gray-400)", fontFamily: "monospace" }}>
              {fps} FPS &middot; {CAPTURE_W}x{CAPTURE_H}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div
          className="card animate-in"
          style={{
            marginBottom: "var(--space-md)",
            borderLeft: "4px solid var(--color-red)",
            color: "var(--color-red)",
            fontWeight: 600,
            fontSize: "var(--text-small)",
          }}
        >
          {error}
        </div>
      )}

      {/* Video + Canvas Overlay */}
      <div
        className="animate-in"
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4/3",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          border: "2px solid var(--color-gray-100)",
          backgroundColor: "#1A1A2E",
          marginBottom: "var(--space-lg)",
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: mirrored ? "scaleX(-1)" : "none",
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            transform: mirrored ? "scaleX(-1)" : "none",
            pointerEvents: "none",
          }}
        />
        {!running && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-sm)",
            }}
          >
            <VideoOff size={48} color="var(--color-gray-300)" />
            <p className="text-small" style={{ color: "var(--color-gray-300)" }}>
              Choose a source above to begin tracking
            </p>
          </div>
        )}
      </div>

      {/* Hidden capture canvas */}
      <canvas ref={captureCanvasRef} style={{ display: "none" }} />

      {/* Landmark Stats */}
      {displayResult && (
        <div className="animate-in" style={{ animationDelay: "60ms" }}>
          <h3 style={{ marginBottom: "var(--space-md)" }}>Detected Landmarks</h3>
          <div className="row" style={{ gap: "var(--space-sm)", marginBottom: "var(--space-md)", flexWrap: "wrap" }}>
            <div className="card" style={{ flex: "1 1 100px", textAlign: "center", padding: "12px" }}>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#00FF88" }}>{poseCount}</div>
              <div className="text-tiny" style={{ color: "var(--color-gray-400)" }}>Pose Joints</div>
            </div>
            <div className="card" style={{ flex: "1 1 100px", textAlign: "center", padding: "12px" }}>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#FF6B6B" }}>{handCount}</div>
              <div className="text-tiny" style={{ color: "var(--color-gray-400)" }}>Hands</div>
            </div>
            <div className="card" style={{ flex: "1 1 100px", textAlign: "center", padding: "12px" }}>
              <div style={{ fontSize: "20px", fontWeight: 800, color: "#A882FF" }}>{faceCount}</div>
              <div className="text-tiny" style={{ color: "var(--color-gray-400)" }}>Face Points</div>
            </div>
          </div>

          {displayResult.pose.length > 0 && (
            <div>
              <h3 style={{ marginBottom: "var(--space-sm)", color: "var(--color-gray-400)" }}>Joint Positions</h3>
              <div className="card" style={{ maxHeight: 200, overflow: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "4px" }}>
                  {displayResult.pose[0]
                    .filter((lm) => lm.label)
                    .map((lm, i) => (
                      <div key={i} className="text-tiny" style={{ fontFamily: "monospace", color: "var(--color-gray-400)" }}>
                        <span style={{ color: "#00FFAA", fontWeight: 700 }}>{lm.label}</span>{" "}
                        x:{lm.x.toFixed(3)} y:{lm.y.toFixed(3)}
                        {lm.visibility !== undefined && <> v:{lm.visibility.toFixed(2)}</>}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
