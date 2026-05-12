/**
 * Unit tests for the noop processTurn implementation.
 *
 * These tests pin the *contract* — what events get emitted in what order,
 * what the response shape looks like, what's preserved from the input.
 * When the noop body is replaced with real LLM calls (Phase 2) or wrapped
 * in Workflow SDK directives (Phase 3), these tests should keep passing
 * with at most a relaxation of the strict ordering assertion (if real
 * implementation emits additional events between the canonical ones).
 */
import { describe, expect, it } from "vitest";
import { processAction } from "../process-turn";
import type { SupervisorEvent, SupervisorTransport } from "../types";

function createRecordingTransport(): {
  transport: SupervisorTransport;
  events: SupervisorEvent[];
} {
  const events: SupervisorEvent[] = [];
  return {
    transport: { emit: (event) => events.push(event) },
    events,
  };
}

describe("processTurn (noop)", () => {
  it("emits rephrased → classified → dispatched → awaiting → completed in order", async () => {
    const { transport, events } = createRecordingTransport();
    await processAction(
      { text: "schedule team standup", threadIds:[], confidence: 1, ack:"hi" },
      "1",
      transport,
    );
    expect(events.map((e) => e.kind)).toEqual(["rephrased", "classified", "dispatched", "awaiting", "completed"]);
  });

  it("returns a non-empty ack from the rephrase step", async () => {
    const { transport } = createRecordingTransport();
    const result =     await processAction(
      { text: "schedule team standup", threadIds:[], confidence: 1, ack:"hi" },
      "1",
      transport,
    );

    expect(result.ack).toBeTruthy();
    expect(typeof result.ack).toBe("string");
  });

  it("returns decision.kind === 'casual' with rephrase fields", async () => {
    const { transport } = createRecordingTransport();
    const result =     await processAction(
      { text: "schedule team standup", threadIds:[], confidence: 1, ack:"hi" },
      "1",
      transport,
    );
    expect(result.decision.kind).toBe("casual");
    expect(result.decision.rephrase.text).toBeTruthy();
    expect(result.decision.rephrase.confidence).toBeGreaterThan(0);
    expect(result.decision.rephrase.ack).toBeTruthy();
  });

  it("returns rephrase with threadIds array", async () => {
    const { transport } = createRecordingTransport();
    const result = await processTurn({ transcript: "x", sessionId: "session-42" }, transport);
    expect(Array.isArray(result.decision.rephrase.threadIds)).toBe(true);
  });

  it("returns an actionId namespaced with 'act_noop_'", async () => {
    const { transport } = createRecordingTransport();
    const result = await processTurn({ transcript: "x", sessionId: "s1" }, transport);
    expect(result.actionId).toMatch(/^act_noop_\d+_\d+$/);
  });

  it("returns a different actionId on each call", async () => {
    const { transport } = createRecordingTransport();
    const a = await processTurn({ transcript: "x", sessionId: "s1" }, transport);
    const b = await processTurn({ transcript: "y", sessionId: "s1" }, transport);
    expect(a.actionId).not.toBe(b.actionId);
  });

  it("truncates the transcript preview at 80 characters in the rephrased event detail", async () => {
    const { transport, events } = createRecordingTransport();
    const longTranscript = "a".repeat(200);
    await processTurn({ transcript: longTranscript, sessionId: "s1" }, transport);
    const rephrased = events.find((e) => e.kind === "rephrased");
    expect(rephrased?.detail?.length).toBeLessThanOrEqual(80);
  });

  it("includes a took_ms field in the completed event payload", async () => {
    const { transport, events } = createRecordingTransport();
    await processTurn({ transcript: "x", sessionId: "s1" }, transport);
    const completed = events.find((e) => e.kind === "completed");
    expect(completed?.payload).toHaveProperty("took_ms");
    expect(typeof completed?.payload?.took_ms).toBe("number");
  });
});
