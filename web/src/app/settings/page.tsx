"use client";

import { useEffect, useState, useRef, useCallback, FormEvent, CSSProperties } from "react";
import { useRouter } from "next/navigation";

import { User, Check, LogOut, Trash2, Volume2, Play, Square } from "lucide-react";

const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

const VOICES = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", desc: "Soft & friendly female", accent: "American", demo: "/voice_demos/sarah.mp3" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", desc: "Calm & warm female", accent: "American", demo: "/voice_demos/rachel.mp3" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", desc: "Deep & authoritative male", accent: "American", demo: "/voice_demos/josh.mp3" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", desc: "Clear & professional male", accent: "American", demo: "/voice_demos/adam.mp3" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", desc: "Natural & elegant female", accent: "British", demo: "/voice_demos/charlotte.mp3" },
];

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Profile form
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Voice selection
  const [selectedVoice, setSelectedVoice] = useState<string>(DEFAULT_VOICE_ID);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Delete account
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteHover, setDeleteHover] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setName(data.user.name);
        setUsername(data.user.username);
        setRole(data.user.role);
        if (data.user.voiceId) setSelectedVoice(data.user.voiceId);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setProfileSaving(true);

    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileMsg({ type: "error", text: data.error || "Failed to update" });
      } else {
        setProfileMsg({ type: "success", text: "Profile updated!" });
      }
    } catch {
      setProfileMsg({ type: "error", text: "Something went wrong" });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleVoiceSelect(voiceId: string) {
    if (voiceId === selectedVoice) return;
    setSelectedVoice(voiceId);
    setVoiceSaving(true);
    setVoiceMsg(null);

    try {
      const res = await fetch("/api/auth/voice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId }),
      });
      if (!res.ok) {
        setVoiceMsg({ type: "error", text: "Failed to save voice" });
      } else {
        setVoiceMsg({ type: "success", text: "Voice saved!" });
        setTimeout(() => setVoiceMsg(null), 2000);
      }
    } catch {
      setVoiceMsg({ type: "error", text: "Something went wrong" });
    } finally {
      setVoiceSaving(false);
    }
  }

  const handlePlayDemo = useCallback((voiceId: string, demoUrl: string) => {
    // If already playing this voice, stop it
    if (playingVoice === voiceId) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingVoice(null);
      return;
    }

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(demoUrl);
    audioRef.current = audio;
    setPlayingVoice(voiceId);

    audio.play();
    audio.onended = () => {
      setPlayingVoice(null);
      audioRef.current = null;
    };
  }, [playingVoice]);

  async function handleDeleteAccount() {
    if (deleteConfirmText !== username) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/auth/delete-account", { method: "DELETE" });
      if (res.ok) {
        router.replace("/login");
      }
    } catch {
      setDeleting(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-gray-300)" }}>
        Loading...
      </div>
    );
  }

  const deleteBtnStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    padding: "10px 16px",
    borderRadius: "var(--radius-md)",
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "var(--text-small)",
    width: "100%",
    transition: "all 0.2s ease",
    backgroundColor: deleteHover ? "var(--color-red-light, #fee)" : "var(--color-snow, #f5f5f5)",
    color: deleteHover ? "var(--color-red)" : "var(--color-gray-400)",
  };

  return (
    <>
      <div className="page" style={{ maxWidth: 1000 }}>
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Settings</h1>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-lg)", alignItems: "start" }}>
          {/* ── Left Column: Profile + Delete + Logout ── */}
          <div>
            {/* ── Profile Section ── */}
            <div className="card animate-in" style={{ marginBottom: "var(--space-lg)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
                <User size={20} color="var(--color-blue)" />
                <h3 style={{ fontWeight: 700 }}>Profile</h3>
                <div className="badge badge-blue" style={{ marginLeft: "auto" }}>{role}</div>
              </div>

              <form onSubmit={handleProfileSubmit} className="stack stack-md">
                <div>
                  <label className="input-label" htmlFor="settings-username">Username</label>
                  <input
                    id="settings-username"
                    type="text"
                    className="input"
                    value={username}
                    readOnly
                    style={{ backgroundColor: "var(--color-snow)", color: "var(--color-gray-400)" }}
                  />
                </div>

                <div>
                  <label className="input-label" htmlFor="settings-name">Full Name</label>
                  <input
                    id="settings-name"
                    type="text"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                {profileMsg && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-sm)",
                      padding: "10px 14px",
                      borderRadius: "var(--radius-md)",
                      backgroundColor: profileMsg.type === "success" ? "var(--color-green-surface)" : "var(--color-red-light)",
                      color: profileMsg.type === "success" ? "var(--color-green-dark)" : "var(--color-red)",
                      fontSize: "var(--text-small)",
                      fontWeight: 600,
                    }}
                  >
                    {profileMsg.type === "success" && <Check size={16} />}
                    {profileMsg.text}
                  </div>
                )}

                <button type="submit" className="btn btn-teal btn-full" disabled={profileSaving}>
                  {profileSaving ? "Saving..." : "Save Changes"}
                </button>
              </form>
            </div>

            {/* ── Delete Account Section ── */}
            <div className="card animate-in" style={{ animationDelay: "60ms", marginBottom: "var(--space-lg)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
                <Trash2 size={18} color={deleteHover ? "var(--color-red)" : "var(--color-gray-400)"} style={{ transition: "color 0.2s ease" }} />
                <h3 style={{ fontWeight: 700 }}>Delete Account</h3>
              </div>

              <p style={{ color: "var(--color-gray-400)", marginBottom: "var(--space-md)", lineHeight: 1.5 }}>
                This will permanently delete your profile, exercise assignments, streaks, and all messages. This cannot be undone.
              </p>

              <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-md)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label className="input-label">Type <strong>{username}</strong> to confirm</label>
                  <input
                    type="text"
                    className="input"
                    placeholder={username}
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleDeleteAccount}
                  onMouseEnter={() => setDeleteHover(true)}
                  onMouseLeave={() => setDeleteHover(false)}
                  style={{ ...deleteBtnStyle, width: "auto", whiteSpace: "nowrap", padding: "10px 24px" }}
                  disabled={deleteConfirmText !== username || deleting}
                >
                  <Trash2 size={14} />
                  {deleting ? "Deleting..." : "Delete Account"}
                </button>
              </div>
            </div>

            {/* ── Logout ── */}
            <button
              onClick={handleLogout}
              className="btn btn-danger btn-full animate-in"
              style={{ animationDelay: "120ms" }}
            >
              <LogOut size={18} />
              Log Out
            </button>
          </div>

          {/* ── Right Column: Voice Selection ── */}
          <div className="card animate-in" style={{ animationDelay: "60ms" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
              <Volume2 size={20} color="var(--color-blue)" />
              <h3 style={{ fontWeight: 700 }}>Coach Voice</h3>
            </div>
            <p style={{ color: "var(--color-gray-400)", fontSize: "var(--text-small)", marginBottom: "var(--space-lg)", lineHeight: 1.5 }}>
              Choose the ElevenLabs voice for your exercise coach. Selection saves automatically.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {VOICES.map((voice) => {
                const isSelected = selectedVoice === voice.id;
                const isPlaying = playingVoice === voice.id;
                return (
                  <div key={voice.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      onClick={() => handleVoiceSelect(voice.id)}
                      disabled={voiceSaving}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-md)",
                        padding: "14px 16px",
                        borderRadius: "var(--radius-md)",
                        border: isSelected ? "2px solid var(--color-blue)" : "2px solid var(--color-snow, #eee)",
                        backgroundColor: isSelected ? "var(--color-blue-surface, #e8f4fd)" : "var(--color-white, #fff)",
                        cursor: voiceSaving ? "wait" : "pointer",
                        transition: "all 0.2s ease",
                        textAlign: "left",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          backgroundColor: isSelected ? "var(--color-blue)" : "var(--color-snow, #f0f0f0)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          transition: "all 0.2s ease",
                        }}
                      >
                        {isSelected ? (
                          <Check size={16} color="white" />
                        ) : (
                          <Volume2 size={14} color="var(--color-gray-400)" />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "var(--text-body)", color: isSelected ? "var(--color-blue)" : "var(--color-gray-600, #333)" }}>
                          {voice.name}
                        </div>
                        <div style={{ fontSize: "var(--text-small)", color: "var(--color-gray-400)", marginTop: 2 }}>
                          {voice.desc} &middot; {voice.accent}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handlePlayDemo(voice.id, voice.demo); }}
                      title={isPlaying ? "Stop" : `Preview ${voice.name}`}
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: "50%",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        transition: "all 0.2s ease",
                        backgroundColor: isPlaying ? "var(--color-blue)" : "var(--color-snow, #f0f0f0)",
                        color: isPlaying ? "white" : "var(--color-gray-500, #666)",
                      }}
                    >
                      {isPlaying ? <Square size={14} /> : <Play size={14} style={{ marginLeft: 2 }} />}
                    </button>
                  </div>
                );
              })}
            </div>

            {voiceMsg && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  marginTop: "var(--space-md)",
                  backgroundColor: voiceMsg.type === "success" ? "var(--color-green-surface)" : "var(--color-red-light)",
                  color: voiceMsg.type === "success" ? "var(--color-green-dark)" : "var(--color-red)",
                  fontSize: "var(--text-small)",
                  fontWeight: 600,
                }}
              >
                {voiceMsg.type === "success" && <Check size={16} />}
                {voiceMsg.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
