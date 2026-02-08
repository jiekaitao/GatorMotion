"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

type ToastType = "error" | "success" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

type Listener = (toast: ToastItem) => void;

let nextId = 0;
const listeners: Set<Listener> = new Set();

export function showToast(message: string, type: ToastType = "info") {
  const toast: ToastItem = { id: nextId++, message, type };
  listeners.forEach((fn) => fn(toast));
}

const TYPE_STYLES: Record<ToastType, { bg: string; color: string; border: string }> = {
  error: { bg: "#fef2f2", color: "#dc2626", border: "#fecaca" },
  success: { bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0" },
  info: { bg: "#eff6ff", color: "#2563eb", border: "#bfdbfe" },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleToast = useCallback((toast: ToastItem) => {
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 4000);
  }, []);

  useEffect(() => {
    listeners.add(handleToast);
    return () => { listeners.delete(handleToast); };
  }, [handleToast]);

  if (!mounted || toasts.length === 0) return null;

  return createPortal(
    <div style={{
      position: "fixed",
      bottom: 24,
      left: 24,
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      maxWidth: 380,
    }}>
      {toasts.map((t) => {
        const s = TYPE_STYLES[t.type];
        return (
          <div
            key={t.id}
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              backgroundColor: s.bg,
              color: s.color,
              border: `1px solid ${s.border}`,
              fontSize: 14,
              fontWeight: 600,
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              animation: "toastSlideIn 0.3s ease forwards",
            }}
          >
            {t.message}
          </div>
        );
      })}
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body
  );
}
