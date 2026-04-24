"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Thread, ThreadMessage } from "@/lib/thread-manager";

function FlashDot({ flashing }: { flashing?: boolean }) {
  return (
    <span
      className="w-2 h-2 rounded-full flex-shrink-0"
      style={{
        background: flashing ? "#f59e0b" : "rgba(255,255,255,0.12)",
        boxShadow: flashing ? "0 0 8px #f59e0b, 0 0 16px rgba(245,158,11,0.35)" : "none",
        animation: flashing ? "dot-flash 2.5s ease-out forwards" : "none",
        transition: "background 0.3s ease, box-shadow 0.3s ease",
      }}
    />
  );
}

function MessageBubble({ msg }: { msg: ThreadMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed"
        style={
          isUser
            ? { background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.20)", color: "rgba(255,255,255,0.75)" }
            : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)" }
        }
      >
        <span
          className="text-[10px] tracking-wider uppercase mr-1.5"
          style={{ color: isUser ? "rgba(245,158,11,0.6)" : "rgba(167,139,250,0.6)" }}
        >
          {msg.role}
        </span>
        {msg.content}
      </div>
    </div>
  );
}

function ThreadCard({ thread, flashing }: { thread: Thread; flashing?: boolean }) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevHistoryLen = useRef(thread.history.length);

  useEffect(() => {
    if (thread.history.length !== prevHistoryLen.current) {
      prevHistoryLen.current = thread.history.length;
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [thread.history.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, []);

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-3"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          className="text-white/90 font-semibold text-sm truncate"
          style={{ fontFamily: "var(--font-syne)" }}
        >
          {thread.name}
        </h2>
        <FlashDot flashing={flashing} />
      </div>

      <p className="text-white/50 text-xs leading-relaxed">{thread.summary}</p>

      <div
        className="flex flex-col gap-1.5 overflow-y-auto rounded-xl"
        style={{
          minHeight: thread.history.length > 0 ? 200 : 48,
          maxHeight: 300,
          padding: thread.history.length > 0 ? "8px" : "0",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        {thread.history.length === 0 ? (
          <p className="text-white/15 text-xs text-center py-3">No messages yet</p>
        ) : (
          <>
            {thread.history.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [flashingIds, setFlashingIds] = useState<Set<string>>(new Set());
  const prevActivityRef = useRef<Map<string, number>>(new Map());

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/threads");
      if (res.ok) {
        const data = await res.json() as Thread[];
        const newlyActive: string[] = [];
        for (const thread of data) {
          const prev = prevActivityRef.current.get(thread.id);
          if (prev !== undefined && thread.lastActivity > prev) {
            newlyActive.push(thread.id);
          }
          prevActivityRef.current.set(thread.id, thread.lastActivity);
        }
        setThreads(data);
        if (newlyActive.length > 0) {
          setFlashingIds((ids) => new Set([...ids, ...newlyActive]));
          setTimeout(() => {
            setFlashingIds((ids) => {
              const next = new Set(ids);
              newlyActive.forEach((id) => next.delete(id));
              return next;
            });
          }, 2600);
        }
      }
    } catch {
      // silently retry on next poll
    }
  }, []);

  useEffect(() => {
    fetchThreads();
    const interval = setInterval(fetchThreads, 5000);
    return () => clearInterval(interval);
  }, [fetchThreads]);

  return (
    <div
      className="min-h-dvh p-4 md:p-8 overflow-y-auto"
      style={{ fontFamily: "var(--font-dm-sans)" }}
    >
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1
            className="text-4xl font-black tracking-tight leading-none mb-1"
            style={{ fontFamily: "var(--font-syne)", color: "#f59e0b" }}
          >
            Ed
          </h1>
          <p className="text-white/30 text-xs tracking-widest uppercase">thread dashboard</p>
        </div>
        <a
          href="/"
          className="text-xs tracking-widest uppercase transition-colors"
          style={{ color: "rgba(255,255,255,0.25)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#f59e0b")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.25)")}
        >
          voice →
        </a>
      </header>

      {threads.length === 0 ? (
        <div className="text-white/20 text-sm text-center py-16">Loading threads…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {threads.map((t) => (
            <ThreadCard key={t.id} thread={t} flashing={flashingIds.has(t.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
