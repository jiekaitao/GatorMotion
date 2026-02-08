"use client";

import { useEffect, useRef, useState } from "react";

interface CameraFeedProps {
  active: boolean;
  onPermissionDenied?: () => void;
  onVideoReady?: (video: HTMLVideoElement) => void;
}

export default function CameraFeed({ active, onPermissionDenied, onVideoReady }: CameraFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }

    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) onVideoReady?.(videoRef.current);
          };
        }
      } catch (err) {
        if (!cancelled) {
          setError("Camera access denied. Please allow camera permissions.");
          onPermissionDenied?.();
          console.error("Camera error:", err);
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [active, onPermissionDenied]);

  if (error) {
    return (
      <div
        style={{
          width: "100%",
          aspectRatio: "16/9",
          backgroundColor: "#1A1A2E",
          borderRadius: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "2px solid #E5E5E5",
          padding: "24px",
        }}
      >
        <p style={{ color: "#AFAFAF", textAlign: "center", fontSize: "14px" }}>
          {error}
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "16/9",
        borderRadius: "20px",
        overflow: "hidden",
        border: "2px solid white",
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        backgroundColor: "#000",
        position: "relative",
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
          transform: "scaleX(-1)",
        }}
      />
    </div>
  );
}
