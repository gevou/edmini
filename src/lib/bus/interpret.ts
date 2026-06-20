/**
 * Inbound interpreter (edmini-dze): classify a free-form Hermes message into a normalized inbound
 * envelope kind. Marker-deterministic first — Hermes uses emoji prefixes (see
 * src/lib/bus/__fixtures__/hermes-messages.json) — with an LLM fallback for plain text.
 * See docs/architecture/edmini-v1-design.md §4.
 */
import type { InboundEnvelopeKind } from "./envelope";

/** A normalized inbound envelope kind, or "ignore" for non-surfaceable noise (progress heartbeats). */
export type InterpretedKind = InboundEnvelopeKind | "ignore";
export type InterpretVia = "marker" | "llm" | "default";

export interface Interpretation {
  kind: InterpretedKind;
  payload: Record<string, unknown>;
  confidence: number;
  via: InterpretVia;
}

/** Plain-text classifier (no deterministic marker). Injected so the core is testable without an
 *  API; the worker wires a real one (llmClassifierFromEnv). */
export type LlmClassifier = (text: string) => Promise<{ kind: InboundEnvelopeKind; confidence: number }>;

function payloadFor(kind: InboundEnvelopeKind, text: string): Record<string, unknown> {
  switch (kind) {
    case "run_blocked": return { question: text };
    case "run_output": return { text };
    case "run_failed": return { error: text };
    case "run_done": return { summary: text };
    case "run_started": return { note: text };
  }
}

/** A deterministic rule that maps a raw message to a normalized interpretation. */
export interface MarkerRule {
  test: (text: string) => boolean;
  toKind: (text: string) => Interpretation;
}

// Hermes's tool-use progress prefixes (it narrates its work). Matched by literal prefix so multi-
// codepoint emoji (e.g. ✍️) compare reliably.
const HERMES_TOOL_PREFIXES = ["💻", "✍️", "📚", "🔧", "🎨", "🔍", "📁", "🌐", "🛠️", "⚙️"];

/**
 * Hermes marker rules — THE harness adapter. This is the ONE place harness-specific conventions
 * (Hermes's emoji prefixes) live; everything downstream (ledger, run-registry, narration) sees only
 * normalized envelope kinds. A different agent system supplies its OWN table to `interpret(..., markers)`
 * — keep harness specifics HERE so the rest of the system never overfits to Hermes. See
 * docs/architecture/edmini-v1-design.md §4 (the interpreter is the swappable harness adapter).
 */
export const HERMES_MARKERS: MarkerRule[] = [
  // A clarifying question it needs answered.
  {
    test: (t) => /^❓/.test(t) || /^clarify\s*:/i.test(t),
    toKind: (t) => ({
      kind: "run_blocked",
      payload: { question: t.replace(/^❓\s*/, "").replace(/^clarify\s*:\s*/i, "").trim() },
      confidence: 0.95,
      via: "marker",
    }),
  },
  // Heartbeat ("still working") — surface nothing.
  {
    test: (t) => /^⏳/.test(t) || /^still working\b/i.test(t),
    toKind: (t) => ({ kind: "ignore", payload: { reason: "heartbeat", text: t }, confidence: 0.95, via: "marker" }),
  },
  // Tool-use PROGRESS — Hermes narrating its work (terminal, file ops, skill/tool loading). NOT a
  // result or completion → surface nothing, so it can't be mistaken for "done" (edmini-73d).
  {
    test: (t) =>
      HERMES_TOOL_PREFIXES.some((p) => t.startsWith(p)) ||
      /^(terminal|write_file|read_file|edit_file|skills_list|bash|mcp)\b/i.test(t),
    toKind: (t) => ({ kind: "ignore", payload: { reason: "tool_progress", text: t }, confidence: 0.9, via: "marker" }),
  },
  // Failure / interruption.
  {
    test: (t) => /^⚠️/.test(t) || /\b(shutting down|interrupted)\b/i.test(t),
    toKind: (t) => ({ kind: "run_failed", payload: { error: t }, confidence: 0.85, via: "marker" }),
  },
  // Run came online.
  {
    test: (t) => /\bonline\b\s*—/.test(t),
    toKind: (t) => ({ kind: "run_started", payload: { note: t }, confidence: 0.7, via: "marker" }),
  },
];

export async function interpret(
  raw: string,
  llm?: LlmClassifier,
  markers: MarkerRule[] = HERMES_MARKERS,
): Promise<Interpretation> {
  const text = raw.trim();

  // ── deterministic harness markers first ──
  for (const m of markers) {
    if (m.test(text)) return m.toKind(text);
  }

  // ── plain text → LLM, else default to a result ──
  if (llm) {
    const r = await llm(text);
    return { kind: r.kind, payload: payloadFor(r.kind, text), confidence: r.confidence, via: "llm" };
  }
  return { kind: "run_output", payload: { text }, confidence: 0.5, via: "default" };
}

/**
 * Real LLM classifier (OpenAI) for plain-text Hermes replies — decides run_output vs run_done vs
 * run_blocked vs run_failed. Used by the bus worker; not exercised in unit tests (needs an API key).
 */
export function llmClassifierFromEnv(model = "gpt-4o-mini"): LlmClassifier {
  return async (text: string) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY required for the LLM interpreter fallback");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "classification",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", enum: ["run_output", "run_done", "run_blocked", "run_failed"] },
                confidence: { type: "number" },
              },
              required: ["kind", "confidence"],
            },
            strict: true,
          },
        },
        messages: [
          {
            role: "system",
            content: `You classify ONE message an autonomous agent (the executor) sent to its supervisor, into exactly one kind. The agent streams MANY messages per task — it announces intent, narrates steps, then finally reports completion — so be conservative: NEVER call something done unless the message explicitly says it finished.

Kinds:
- run_blocked — it asks the USER a question or needs a decision/input to proceed ("Should I…?", "Which…?", "Want me to…?", "Could you confirm…?", or otherwise ends asking the user). If a message BOTH reports something AND asks the user a question, choose run_blocked — the question must be surfaced.
- run_failed — it reports an error, a failure, or that it was interrupted / could not complete.
- run_done — it EXPLICITLY reports the task is complete: past-tense/declarative completion like "Done", "Completed", "Finished", "I've created…", "All set", "✅". NOT mere intent or an in-progress step.
- run_output — everything else the agent says while WORKING: intent/plans ("I'll create…", "I'm going to…", "Let me…", "Now I'll…", gerunds like "Creating…"), progress narration, or a substantive intermediate result/answer.

Decisive rules:
- FUTURE/INTENT phrasing ("I'll…", "I'm going to…", "Let me…", "Now…", "Creating…") is run_output, NOT run_done.
- Only PAST-TENSE / explicit completion is run_done.
- When unsure between run_output and run_done, choose run_output.
- A question to the user always wins → run_blocked.`,
          },
          { role: "user", content: text.slice(0, 4000) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`interpreter LLM failed (${res.status})`);
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    return { kind: parsed.kind as InboundEnvelopeKind, confidence: Number(parsed.confidence ?? 0.5) };
  };
}
