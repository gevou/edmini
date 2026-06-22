import { describe, it, expect } from "vitest";
import { createRunRegistry, buildRegistryFromEvents } from "../run-registry";
import type { LedgerEvent } from "../../ledger";

describe("run-registry", () => {
  it("registers a free label and resolves it both ways", () => {
    const r = createRunRegistry();
    expect(r.register("run-1", "export")).toBe("export");
    expect(r.resolveLabel("export")).toBe("run-1");
    expect(r.labelFor("run-1")).toBe("export");
    expect(r.has("run-1")).toBe(true);
  });

  it("suffixes a colliding label and keeps both addressable", () => {
    const r = createRunRegistry();
    expect(r.register("run-1", "export")).toBe("export");
    expect(r.register("run-2", "export")).toBe("export-2");
    expect(r.register("run-3", "export")).toBe("export-3");
    expect(r.resolveLabel("export")).toBe("run-1");
    expect(r.resolveLabel("export-2")).toBe("run-2");
    expect(r.resolveLabel("export-3")).toBe("run-3");
  });

  it("is idempotent: re-registering the same runId returns its existing label", () => {
    const r = createRunRegistry();
    expect(r.register("run-1", "export")).toBe("export");
    expect(r.register("run-1", "something-else")).toBe("export");
  });

  it("frees the label on remove", () => {
    const r = createRunRegistry();
    r.register("run-1", "export");
    r.remove("run-1");
    expect(r.resolveLabel("export")).toBeNull();
    expect(r.labelFor("run-1")).toBeNull();
    expect(r.has("run-1")).toBe(false);
    // label is reusable afterwards
    expect(r.register("run-9", "export")).toBe("export");
  });

  it("defaults a blank label to 'task'", () => {
    const r = createRunRegistry();
    expect(r.register("run-1", "   ")).toBe("task");
    expect(r.register("run-2", "")).toBe("task-2");
  });

  it("returns null for unknown runId / label", () => {
    const r = createRunRegistry();
    expect(r.resolveLabel("nope")).toBeNull();
    expect(r.labelFor("nope")).toBeNull();
    expect(r.has("nope")).toBe(false);
  });

  it("tracks status without affecting addressing", () => {
    const r = createRunRegistry();
    r.register("run-1", "export");
    r.setStatus("run-1", "blocked");
    expect(r.labelFor("run-1")).toBe("export");
    // setStatus on an unknown run is a no-op (doesn't throw)
    expect(() => r.setStatus("nope", "done")).not.toThrow();
  });
});

const dispatch = (seq: number, runId: string, label: string | null): LedgerEvent => ({
  seq, runId, source: "edmini", kind: "task_dispatch", payload: { label },
});
const harness = (seq: number, runId: string, kind: string): LedgerEvent => ({
  seq, runId, source: "harness", kind, payload: {},
});

describe("buildRegistryFromEvents", () => {
  it("registers every dispatched run so labelFor is non-null (fixes b)", () => {
    const reg = buildRegistryFromEvents([dispatch(1, "run_a", "export")]);
    expect(reg.labelFor("run_a")).toBe("export");
    expect(reg.resolveLabel("export")).toBe("run_a");
  });

  it("replays in seq order and applies the existing collision-suffix rule", () => {
    const reg = buildRegistryFromEvents([
      dispatch(2, "run_b", "export"),
      dispatch(1, "run_a", "export"),
    ]);
    // seq 1 (run_a) registers "export"; seq 2 (run_b) collides → "export-2"
    expect(reg.labelFor("run_a")).toBe("export");
    expect(reg.labelFor("run_b")).toBe("export-2");
  });

  it("registers runs regardless of their terminal status", () => {
    const reg = buildRegistryFromEvents([
      dispatch(1, "run_a", "export"), harness(2, "run_a", "run_done"),
      dispatch(3, "run_b", "research"), harness(4, "run_b", "run_failed"),
    ]);
    expect(reg.labelFor("run_a")).toBe("export");
    expect(reg.labelFor("run_b")).toBe("research");
  });

  it("falls back to 'task' for a missing/empty label (register default)", () => {
    const reg = buildRegistryFromEvents([dispatch(1, "run_a", null)]);
    expect(reg.labelFor("run_a")).toBe("task");
  });

  it("ignores non-dispatch events for registration", () => {
    const reg = buildRegistryFromEvents([harness(1, "run_x", "run_output")]);
    expect(reg.labelFor("run_x")).toBeNull();
  });
});
