"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Thread, ThreadMessage } from "@/lib/thread-manager";


const CATEGORY_ICON: Record<string, string> = {
  publishing:  "✦",
  engineering: "⬡",
  career:      "◈",
};

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface ActivityItem {
  threadId: string;
  threadName: string;
  message: ThreadMessage;
}

function StatusBadge({ flashing }: { flashing?: boolean }) {
  return (
    <span
      className="w-3 h-3 rounded-full flex-shrink-0"
      style={{
        background: "#52525b",
        opacity: 0.35,
        animation: flashing ? "badge-flash 1.1s ease-out forwards" : "none",
      }}
    />
  );
}

function ThreadCard({ thread, flashing }: { thread: Thread; flashing?: boolean }) {
  const icon = CATEGORY_ICON[thread.category] ?? "◦";
  const lastMsg = thread.history[thread.history.length - 1];

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-3 transition-all duration-200"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-white/20 text-sm flex-shrink-0">{icon}</span>
          <h2 className="text-white/90 font-semibold text-sm truncate" style={{ fontFamily: "var(--font-syne)" }}>
            {thread.name}
          </h2>
        </div>
        <StatusBadge flashing={flashing} />
      </div>

      <p className="text-white/50 text-xs leading-relaxed">{thread.summary}</p>

      {lastMsg && (
        <div
          className="rounded-xl px-3 py-2 text-xs text-white/35 leading-relaxed"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          <span className="text-white/20 uppercase tracking-wider mr-2">{lastMsg.role}</span>
          {lastMsg.content.length > 120 ? lastMsg.content.slice(0, 120) + "…" : lastMsg.content}
        </div>
      )}

      <div className="flex items-center justify-between mt-1">
        <span className="text-white/20 text-xs tracking-wider uppercase">{thread.category}</span>
        <span className="text-white/20 text-xs">{timeAgo(thread.lastActivity)}</span>
      </div>
    </div>
  );
}

function ActivityFeed({ threads }: { threads: Thread[] }) {
  const items: ActivityItem[] = threads
    .flatMap((t) =>
      t.history.map((msg) => ({ threadId: t.id, threadName: t.name, message: msg }))
    )
    .sort((a, b) => b.message.timestamp - a.message.timestamp)
    .slice(0, 20);

  if (items.length === 0) {
    return (
      <div className="text-white/20 text-xs text-center py-8">No messages yet</div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div
          key={`${item.threadId}-${item.message.timestamp}-${i}`}
          className="flex gap-3 items-start"
        >
          <div className="flex-shrink-0 mt-0.5">
            <div
              className="w-1.5 h-1.5 rounded-full mt-1.5"
              style={{ background: item.message.role === "user" ? "#f59e0b" : "#a78bfa" }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-white/40 text-xs font-medium">{item.threadName}</span>
              <span className="text-white/20 text-xs">{timeAgo(item.message.timestamp)}</span>
            </div>
            <p className="text-white/50 text-xs leading-relaxed">
              <span className="text-white/25 uppercase tracking-wider mr-1.5">{item.message.role}</span>
              {item.message.content.length > 150 ? item.message.content.slice(0, 150) + "…" : item.message.content}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [flashingIds, setFlashingIds] = useState<Set<string>>(new Set());
  const prevActivityRef = useRef<Map<string, number>>(new Map());

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/threads");
      if (res.ok) {
        const data = await res.json() as Thread[];
        // Detect threads that received new messages since last poll
        const newlyActive: string[] = [];
        for (const thread of data) {
          const prev = prevActivityRef.current.get(thread.id);
          if (prev !== undefined && thread.lastActivity > prev) {
            newlyActive.push(thread.id);
          }
          prevActivityRef.current.set(thread.id, thread.lastActivity);
        }
        setThreads(data);
        setLastRefresh(Date.now());
        if (newlyActive.length > 0) {
          setFlashingIds((ids) => new Set([...ids, ...newlyActive]));
          setTimeout(() => {
            setFlashingIds((ids) => {
              const next = new Set(ids);
              newlyActive.forEach((id) => next.delete(id));
              return next;
            });
          }, 1200);
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

  const activeCount = threads.filter((t) => t.status === "active").length;
  const waitingCount = threads.filter((t) => t.status === "waiting").length;

  return (
    <div
      className="min-h-dvh p-4 md:p-8"
      style={{ fontFamily: "var(--font-dm-sans)" }}
    >
      {/* Header */}
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
        <div className="flex items-center gap-4 text-right">
          <div className="text-xs text-white/30">
            <span className="text-white/60 font-medium">{activeCount}</span> active
            <span className="mx-2 text-white/15">·</span>
            <span className="text-white/60 font-medium">{waitingCount}</span> waiting
          </div>
          <div className="text-xs text-white/20">
            refreshed {timeAgo(lastRefresh)}
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
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Threads grid */}
        <div className="lg:col-span-2">
          <h2 className="text-white/30 text-xs tracking-widest uppercase mb-4">Threads</h2>
          {threads.length === 0 ? (
            <div className="text-white/20 text-sm text-center py-16">Loading threads…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {threads.map((t) => (
                <ThreadCard key={t.id} thread={t} flashing={flashingIds.has(t.id)} />
              ))}
            </div>
          )}
        </div>

        {/* Activity feed */}
        <div>
          <h2 className="text-white/30 text-xs tracking-widest uppercase mb-4">Recent Activity</h2>
          <div
            className="rounded-2xl p-4"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <ActivityFeed threads={threads} />
          </div>
        </div>
      </div>
    </div>
  );
}
