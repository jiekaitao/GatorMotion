"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, X, ExternalLink } from "lucide-react";

const STORAGE_KEY = "gatormotion-backend-notice-dismissed";

export default function BackendNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissed = sessionStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    setVisible(false);
    sessionStorage.setItem(STORAGE_KEY, "1");
  }

  if (!visible) return null;

  return (
    <div className="backend-notice-overlay" onClick={dismiss}>
      <div className="backend-notice-card" onClick={(e) => e.stopPropagation()}>
        <button className="backend-notice-close" onClick={dismiss} aria-label="Close">
          <X size={20} />
        </button>

        <div className="backend-notice-icon">
          <AlertTriangle size={32} color="var(--color-orange)" />
        </div>

        <h2 className="backend-notice-title">Demo Mode</h2>

        <p className="backend-notice-body">
          The Computer Vision and real-time coaching features are currently
          <strong> unavailable</strong> as the backend servers have been disabled
          to save on hosting costs.
        </p>

        <p className="backend-notice-body">
          You can still explore the UI, browse exercises, and see how the app is
          designed to work.
        </p>

        <div className="backend-notice-contact">
          <p className="backend-notice-contact-label">Questions? Reach out to:</p>
          <a
            href="https://www.linkedin.com/in/jie-tao-0a8480242/"
            target="_blank"
            rel="noopener noreferrer"
            className="backend-notice-link"
          >
            Jie Tao
            <ExternalLink size={14} />
          </a>
        </div>

        <button className="btn btn-primary backend-notice-btn" onClick={dismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}
