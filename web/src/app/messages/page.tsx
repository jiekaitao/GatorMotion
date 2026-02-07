"use client";

import { useEffect, useState, useRef, FormEvent, useCallback } from "react";
import { useRouter } from "next/navigation";

import { Send, ArrowLeft, MessageCircle, User } from "lucide-react";

interface Conversation {
  partnerId: string;
  partnerName: string;
  partnerRole: string;
  lastMessage: { content: string; createdAt: string; senderId: string } | null;
  unreadCount: number;
}

interface Message {
  _id: string;
  senderId: string;
  receiverId: string;
  content: string;
  isMine: boolean;
  createdAt: string;
}

export default function MessagesPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [activeName, setActiveName] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string>("patient");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch conversation list
  useEffect(() => {
    async function load() {
      try {
        const [meRes, convRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/messages"),
        ]);
        if (!meRes.ok) { router.replace("/login"); return; }
        const meData = await meRes.json();
        const convData = await convRes.json();
        setRole(meData.user.role);
        setConversations(convData.conversations || []);

        // If patient with only one contact, auto-open that chat
        if (meData.user.role === "patient" && convData.conversations?.length === 1) {
          const c = convData.conversations[0];
          setActiveChat(c.partnerId);
          setActiveName(c.partnerName);
        }
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  // Fetch messages for active chat + poll
  const fetchMessages = useCallback(async () => {
    if (!activeChat) return;
    try {
      const res = await fetch(`/api/messages/${activeChat}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch { /* ignore */ }
  }, [activeChat]);

  useEffect(() => {
    if (!activeChat) return;
    fetchMessages();
    // Poll every 3 seconds
    pollRef.current = setInterval(fetchMessages, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeChat, fetchMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!newMsg.trim() || !activeChat) return;
    setSending(true);
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: activeChat, content: newMsg.trim() }),
      });
      setNewMsg("");
      await fetchMessages();
    } catch { /* ignore */ }
    finally { setSending(false); }
  }

  function openChat(partnerId: string, partnerName: string) {
    setActiveChat(partnerId);
    setActiveName(partnerName);
    setMessages([]);
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-gray-300)" }}>
        Loading...
      </div>
    );
  }

  // Chat view
  if (activeChat) {
    return (
      <>
        <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 60px)", maxHeight: "calc(100vh - 60px)" }}>
          {/* Chat Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-md)",
              padding: "var(--space-md) var(--space-lg)",
              borderBottom: "2px solid var(--color-gray-100)",
              backgroundColor: "var(--color-white)",
              flexShrink: 0,
            }}
          >
            {(role === "therapist" || conversations.length > 1) && (
              <button
                onClick={() => setActiveChat(null)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--color-gray-400)" }}
              >
                <ArrowLeft size={22} />
              </button>
            )}
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--color-blue-light)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <User size={18} color="var(--color-blue)" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "var(--text-body)" }}>{activeName}</div>
            </div>
          </div>

          {/* Messages Area */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "var(--space-lg)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-sm)",
            }}
          >
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--color-gray-300)", marginTop: "var(--space-2xl)" }}>
                <MessageCircle size={40} style={{ margin: "0 auto var(--space-md)", opacity: 0.4 }} />
                <p style={{ fontWeight: 600 }}>No messages yet</p>
                <p className="text-small" style={{ marginTop: 4 }}>Send a message to start the conversation.</p>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg._id}
                style={{
                  display: "flex",
                  justifyContent: msg.isMine ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "75%",
                    padding: "10px 16px",
                    borderRadius: msg.isMine ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                    backgroundColor: msg.isMine ? "var(--color-primary)" : "var(--color-white)",
                    color: msg.isMine ? "white" : "var(--color-gray-600)",
                    border: msg.isMine ? "none" : "2px solid var(--color-gray-100)",
                    fontSize: "var(--text-body)",
                    lineHeight: 1.4,
                    wordBreak: "break-word",
                  }}
                >
                  {msg.content}
                  <div
                    style={{
                      fontSize: "11px",
                      marginTop: 4,
                      opacity: 0.6,
                      textAlign: "right",
                    }}
                  >
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <form
            onSubmit={handleSend}
            style={{
              display: "flex",
              gap: "var(--space-sm)",
              padding: "var(--space-md) var(--space-lg)",
              borderTop: "2px solid var(--color-gray-100)",
              backgroundColor: "var(--color-white)",
              flexShrink: 0,
            }}
          >
            <input
              type="text"
              className="input"
              placeholder="Type a message..."
              value={newMsg}
              onChange={(e) => setNewMsg(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="submit"
              className="btn btn-teal"
              disabled={sending || !newMsg.trim()}
              style={{ padding: "12px 16px" }}
            >
              <Send size={20} />
            </button>
          </form>
        </div>
      </>
    );
  }

  // Conversation List (therapist or patient with multiple contacts)
  return (
    <>
      <div className="page">
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Messages</h1>

        {conversations.length > 0 ? (
          <div className="stack stack-sm">
            {conversations.map((c) => (
              <button
                key={c.partnerId}
                onClick={() => openChat(c.partnerId, c.partnerName)}
                className="card-interactive"
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-md)",
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--color-blue-light)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <User size={22} color="var(--color-blue)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>{c.partnerName}</span>
                    {c.unreadCount > 0 && (
                      <span
                        style={{
                          backgroundColor: "var(--color-primary)",
                          color: "white",
                          fontSize: "12px",
                          fontWeight: 700,
                          borderRadius: "var(--radius-full)",
                          minWidth: 22,
                          height: 22,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0 6px",
                        }}
                      >
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "var(--text-small)",
                      color: "var(--color-gray-400)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      marginTop: 2,
                    }}
                  >
                    {c.lastMessage
                      ? c.lastMessage.content
                      : "No messages yet — tap to start"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="card text-center" style={{ padding: "var(--space-2xl) var(--space-lg)" }}>
            <MessageCircle size={48} color="var(--color-gray-200)" style={{ margin: "0 auto var(--space-md)" }} />
            <h2 style={{ color: "var(--color-gray-400)" }}>No Conversations</h2>
            <p className="text-small" style={{ marginTop: "var(--space-sm)" }}>
              {role === "patient"
                ? "You'll be able to message your therapist once they invite you."
                : "Add patients to start messaging them."}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
