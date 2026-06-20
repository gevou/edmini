import { describe, it, expect } from "vitest";
import { createRunRegistry } from "../run-registry";

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
