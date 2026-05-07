"use client";

import { useEffect, useRef } from "react";
import {
  clearEvents,
  pushTestSequence,
  useEventLog,
  type EventLogEntry,
  type EventLogKind,
} from "@/lib/event-log-store";

/**
 * Inline event log view — for embedding inside a layout (e.g. the dashboard
 * page) rather than as a fixed-position overlay.
 *
 * Same data source as <EventLogPanel /> (the module-level store in
 * @/lib/event-log-store), so events emitted by the voice front-end show up
 * here too. Cross-page navigation in Next.js App Router preserves the store
 * (soft navigation); a hard reload clears it.
 */
export default function EventLogView({ className = "" }: { className?: string }) {
  const events = useEventLog();
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  return (
    <section
      className={`flex flex-col rounded-2xl ${className}`}
      style={{
        background: "rgba(14, 10, 4, 0.65)",
        border: "1px solid rgba(255,255,255,0.07)",
        minHeight: 320,
      }}
      aria-label="Event log"
    >
      {/* Header */}
      <header
        className="shrink-0 flex items-center justify-between gap-2"
        style={{
          padding: "16px 16px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex flex-col">
          <h2
            className="text-sm font-semibold tracking-wider uppercase"
            style={{
              color: "rgba(255,255,255,0.7)",
              fontFamily: "var(--font-syne)",
            }}
          >
            Event log
          </h2>
          <p className="text-[10px] tracking-widest uppercase mt-0.5 text-white/30">
            voice + supervisor
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={pushTestSequence}
            className="text-[10px] tracking-widest uppercase rounded-md px-2.5 py-1.5 transition-colors"
            style={{
              background: "rgba(245,158,11,0.10)",
              border: "1px solid rgba(245,158,11,0.25)",
              color: "#f59e0b",
            }}
            title="Push a sequence of fake events to verify rendering"
          >
            Test
          </button>
          <button
            onClick={clearEvents}
            className="text-[10px] tracking-widest uppercase rounded-md px-2.5 py-1.5 transition-colors hover:bg-white/5"
            style={{
              border: "1px solid rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.45)",
            }}
            title="Clear the event log"
          >
            Clear
          </button>
        </div>
      </header>

      {/* Scrollable list */}
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto"
        style={{
          padding: "10px 12px 16px",
          maxHeight: "calc(100vh - 280px)",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-12 text-center">
            <p className="text-white/25 text-xs">No events yet</p>
            <p className="text-white/20 text-[10px] max-w-[260px] leading-relaxed">
              Press <span className="text-amber-500/70">Test</span> to push a
              fake sequence, or speak to Ed on the voice page — events will
              flow through here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {events.map((evt) => (
              <EventRow key={evt.id} entry={evt} />
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <footer
        className="shrink-0 flex items-center justify-between text-[10px] tracking-widest uppercase"
        style={{
          padding: "8px 16px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          color: "rgba(255,255,255,0.30)",
        }}
      >
        <span>{events.length} event{events.length === 1 ? "" : "s"}</span>
        <span className="text-white/20">supervisor demo</span>
      </footer>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

const KIND_META: Record<
  EventLogKind,
  { icon: string; color: string; bg: string }
> = {
  session_started:    { icon: "▶", color: "#f59e0b", bg: "rgba(245,158,11,0.10)" },
  session_ended:      { icon: "■", color: "rgba(255,255,255,0.45)", bg: "rgba(255,255,255,0.04)" },
  user_spoke:         { icon: "🎤", color: "#fbbf24", bg: "rgba(251,191,36,0.08)" },
  user_paused:        { icon: "🔇", color: "rgba(255,255,255,0.55)", bg: "rgba(255,255,255,0.04)" },
  user_interrupted:   { icon: "✋", color: "#fb923c", bg: "rgba(251,146,60,0.10)" },
  model_speaking:     { icon: "🗣", color: "#a78bfa", bg: "rgba(167,139,250,0.10)" },

  rephrased:           { icon: "🧠", color: "#7dd3fc", bg: "rgba(125,211,252,0.08)" },
  classified:          { icon: "🎯", color: "#67e8f9", bg: "rgba(103,232,249,0.08)" },
  clarification_needed:{ icon: "❓", color: "#fde047", bg: "rgba(253,224,71,0.08)" },
  dispatched:          { icon: "🚀", color: "#86efac", bg: "rgba(134,239,172,0.08)" },
  awaiting:            { icon: "⏳", color: "rgba(255,255,255,0.55)", bg: "rgba(255,255,255,0.04)" },
  completed:           { icon: "✅", color: "#4ade80", bg: "rgba(74,222,128,0.10)" },
  failed:              { icon: "❌", color: "#f87171", bg: "rgba(248,113,113,0.10)" },
  retried:             { icon: "🔄", color: "#facc15", bg: "rgba(250,204,21,0.10)" },
  cancelled:           { icon: "🛑", color: "#fca5a5", bg: "rgba(252,165,165,0.10)" },

  info:  { icon: "•", color: "rgba(255,255,255,0.55)", bg: "rgba(255,255,255,0.04)" },
  error: { icon: "!", color: "#f87171", bg: "rgba(248,113,113,0.10)" },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function EventRow({ entry }: { entry: EventLogEntry }) {
  const meta = KIND_META[entry.kind];

  return (
    <li
      className="rounded-lg px-2.5 py-2 flex flex-col gap-1"
      style={{
        background: meta.bg,
        border: `1px solid ${meta.color}22`,
      }}
    >
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden="true"
          className="shrink-0 text-sm leading-none w-4 text-center"
          style={{ color: meta.color }}
        >
          {meta.icon}
        </span>
        <span
          className="text-[12px] font-medium leading-snug flex-1"
          style={{ color: meta.color }}
        >
          {entry.label}
        </span>
        <span className="text-[9px] tracking-wider tabular-nums text-white/25 shrink-0">
          {formatTime(entry.timestamp)}
        </span>
      </div>
      {entry.detail && (
        <p
          className="text-[11px] leading-snug pl-6"
          style={{ color: "rgba(255,255,255,0.55)" }}
        >
          {entry.detail}
        </p>
      )}
      {entry.payload && (
        <pre
          className="text-[10px] leading-tight pl-6 mt-0.5 rounded px-2 py-1.5 overflow-x-auto"
          style={{
            background: "rgba(0,0,0,0.30)",
            color: "rgba(255,255,255,0.55)",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          }}
        >
          {JSON.stringify(entry.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}
