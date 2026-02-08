"use client";

interface SetBreakOverlayProps {
  secondsRemaining: number;
  currentSet: number;
  totalSets: number;
  onSkip: () => void;
}

export default function SetBreakOverlay({
  secondsRemaining,
  currentSet,
  totalSets,
  onSkip,
}: SetBreakOverlayProps) {
  const nextSet = Math.min(currentSet + 1, totalSets);

  return (
    <div className="pain-stop-overlay" style={{ background: "rgba(2, 202, 202, 0.14)" }} onClick={onSkip}>
      <div
        className="pain-stop-card"
        style={{ borderColor: "var(--color-primary)", boxShadow: "0 16px 48px rgba(2, 202, 202, 0.24)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          style={{
            fontSize: "28px",
            fontWeight: 800,
            color: "var(--color-gray-600)",
            marginBottom: "var(--space-sm)",
          }}
        >
          Take a break
        </h2>
        <p style={{ fontSize: "15px", color: "var(--color-gray-400)", marginBottom: "var(--space-lg)" }}>
          Starting set {nextSet} of {totalSets}
        </p>
        <div
          style={{
            width: 112,
            height: 112,
            borderRadius: "var(--radius-full)",
            margin: "0 auto",
            backgroundColor: "var(--color-primary-light)",
            border: "3px solid var(--color-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontSize: "44px",
              lineHeight: 1,
              fontWeight: 800,
              color: "var(--color-primary-dark)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {secondsRemaining}
          </span>
        </div>

        <button
          className="btn btn-secondary"
          style={{ marginTop: "var(--space-xl)", minWidth: 220, borderRadius: "var(--radius-xl)" }}
          onClick={onSkip}
        >
          Continue now
        </button>
        <p
          style={{ fontSize: "12px", color: "var(--color-gray-300)", marginTop: "var(--space-md)", cursor: "pointer" }}
          onClick={onSkip}
        >
          Click to skip
        </p>
      </div>
    </div>
  );
}
