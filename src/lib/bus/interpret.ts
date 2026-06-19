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

export async function interpret(raw: string, llm?: LlmClassifier): Promise<Interpretation> {
  const text = raw.trim();

  // ── marker-deterministic (Hermes emoji prefixes) ──
  if (/^❓/.test(text) || /^clarify\s*:/i.test(text)) {
    const question = text.replace(/^❓\s*/, "").replace(/^clarify\s*:\s*/i, "").trim();
    return { kind: "run_blocked", payload: { question }, confidence: 0.95, via: "marker" };
  }
  if (/^⏳/.test(text) || /^still working\b/i.test(text)) {
    return { kind: "ignore", payload: { reason: "heartbeat", text }, confidence: 0.95, via: "marker" };
  }
  if (/^⚠️/.test(text) || /\b(shutting down|interrupted)\b/i.test(text)) {
    return { kind: "run_failed", payload: { error: text }, confidence: 0.85, via: "marker" };
  }
  if (/\bonline\b\s*—/.test(text)) {
    return { kind: "run_started", payload: { note: text }, confidence: 0.7, via: "marker" };
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
          { role: "system", content: "Classify one message from an autonomous agent to its supervisor. run_blocked = it asks the user a question; run_failed = it reports an error/failure; run_done = a final completion with little content; run_output = a substantive result/answer. Reply with the JSON schema." },
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
