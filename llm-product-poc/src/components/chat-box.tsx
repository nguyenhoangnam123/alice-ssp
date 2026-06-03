"use client";

import { useState } from "react";

type Msg = { role: "user" | "assistant" | "system"; text: string };

/**
 * Minimal chat UI. POSTs each message to /api/chat/message. The server
 * routes through meteredBedrockInvoke so every call lands in llm_calls.
 *
 * On a budget-exceeded response (HTTP 402) the UI shows the platform's
 * guarded-action reason verbatim — exactly what the user sees if the
 * tenant has hit its monthly cap.
 */
export function ChatBox({ userSub }: { userSub: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next);
    setInput("");
    try {
      const res = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          history: next,
          user_sub: userSub,
        }),
      });
      if (res.status === 402) {
        const body = await res.json();
        setError(
          `Tenant over Bedrock monthly cap — spent $${body.spent_usd?.toFixed?.(4)} of $${body.cap_usd?.toFixed?.(2)}. Reset on the 1st.`,
        );
        setMessages(next); // leave the user message visible
        return;
      }
      if (!res.ok) {
        const body = await res.text();
        setError(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        return;
      }
      const body = await res.json();
      setMessages([...next, { role: "assistant", text: body.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded">
      <div className="p-3 space-y-3 min-h-[300px] max-h-[60vh] overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-muted text-sm">No messages yet. Say hi.</p>
        ) : (
          messages.map((m, i) => (
            <div key={i}>
              <div className="text-xs text-muted mb-0.5">{m.role}</div>
              <div className="whitespace-pre-wrap text-sm">{m.text}</div>
            </div>
          ))
        )}
        {busy && (
          <div className="text-muted text-xs">thinking…</div>
        )}
        {error && (
          <div className="text-red-400 text-sm border border-red-700 rounded p-2">
            {error}
          </div>
        )}
      </div>
      <form
        className="border-t border-border p-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ask something…"
          disabled={busy}
          className="flex-1"
        />
        <button type="submit" disabled={busy}>
          send
        </button>
      </form>
    </div>
  );
}
