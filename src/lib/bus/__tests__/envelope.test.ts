import { describe, it, expect } from "vitest";
import {
  INBOUND_KINDS,
  OUTBOUND_KINDS,
  TERMINAL_INBOUND_KINDS,
  isInboundKind,
  isOutboundKind,
  isEnvelopeKind,
  isTerminalKind,
  type Envelope,
} from "../envelope";

describe("envelope kind guards", () => {
  it("classifies inbound kinds", () => {
    expect(isInboundKind("run_blocked")).toBe(true);
    expect(isInboundKind("task_dispatch")).toBe(false);
    expect(isInboundKind("nonsense")).toBe(false);
  });

  it("classifies outbound kinds", () => {
    expect(isOutboundKind("cancel")).toBe(true);
    expect(isOutboundKind("run_done")).toBe(false);
  });

  it("isEnvelopeKind accepts both directions, rejects junk", () => {
    for (const k of [...INBOUND_KINDS, ...OUTBOUND_KINDS]) {
      expect(isEnvelopeKind(k)).toBe(true);
    }
    expect(isEnvelopeKind("")).toBe(false);
    expect(isEnvelopeKind("run_paused")).toBe(false);
  });

  it("inbound and outbound sets are disjoint", () => {
    const overlap = INBOUND_KINDS.filter((k) => (OUTBOUND_KINDS as readonly string[]).includes(k));
    expect(overlap).toEqual([]);
  });

  it("terminal kinds are a subset of inbound", () => {
    for (const k of TERMINAL_INBOUND_KINDS) expect(isInboundKind(k)).toBe(true);
    expect(isTerminalKind("run_done")).toBe(true);
    expect(isTerminalKind("run_failed")).toBe(true);
    expect(isTerminalKind("run_output")).toBe(false);
    expect(isTerminalKind("run_started")).toBe(false);
  });

  it("typed payload compiles and round-trips", () => {
    const e: Envelope<"run_blocked"> = {
      kind: "run_blocked",
      runId: "123456789",
      seq: 1,
      ts: 1_700_000_000_000,
      payload: { question: "staging or prod?" },
    };
    expect(e.payload.question).toBe("staging or prod?");
  });
});
