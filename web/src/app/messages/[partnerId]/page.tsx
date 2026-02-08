"use client";

import { useEffect, useState, useRef, FormEvent, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { Send, ArrowLeft, MessageCircle, User } from "lucide-react";

interface Message {
  _id: string;
  senderId: string;
  receiverId: string;
  content: string;
  isMine: boolean;
  createdAt: string;
}

export default function ChatPage() {
  const router = useRouter();
  const { partnerId } = useParams<{ partnerId: string }>();
  const searchParams = useSearchParams();
  const partnerName = searchParams.get("name") || "Chat";

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async () => {
    if (!partnerId) return;
    try {
      const res = await fetch(`/api/messages/${partnerId}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useEffect(() => {
    fetchMessages();
    pollRef.current = setInterval(fetchMessages, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!newMsg.trim() || !partnerId) return;
    setSending(true);
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: partnerId, content: newMsg.trim() }),
      });
      setNewMsg("");
      await fetchMessages();
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "var(--color-gray-300)",
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100dvh - 120px)",
        maxHeight: "calc(100dvh - 120px)",
      }}
    >
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
        <button
          onClick={() => router.push("/home")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            color: "var(--color-gray-400)",
          }}
        >
          <ArrowLeft size={22} />
        </button>
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
          <div style={{ fontWeight: 700, fontSize: "var(--text-body)" }}>
            {partnerName}
          </div>
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
          <div
            style={{
              textAlign: "center",
              color: "var(--color-gray-300)",
              marginTop: "var(--space-2xl)",
            }}
          >
            <MessageCircle
              size={40}
              style={{ margin: "0 auto var(--space-md)", opacity: 0.4 }}
            />
            <p style={{ fontWeight: 600 }}>No messages yet</p>
            <p className="text-small" style={{ marginTop: 4 }}>
              Send a message to start the conversation.
            </p>
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
                borderRadius: msg.isMine
                  ? "18px 18px 4px 18px"
                  : "18px 18px 18px 4px",
                backgroundColor: msg.isMine
                  ? "var(--color-primary)"
                  : "var(--color-white)",
                color: msg.isMine ? "white" : "var(--color-gray-600)",
                border: msg.isMine
                  ? "none"
                  : "2px solid var(--color-gray-100)",
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
                {new Date(msg.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
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
  );
}
