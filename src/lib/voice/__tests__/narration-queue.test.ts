import { describe, it, expect } from "vitest";
import { createNarrationQueue, type NarrationItem } from "../narration-queue";

const item = (over: Partial<NarrationItem> = {}): NarrationItem => ({
  priority: "low",
  kind: "run_output",
  text: "result",
  ...over,
});

describe("narration-queue", () => {
  it("drains nothing when empty", () => {
    const q = createNarrationQueue();
    expect(q.isEmpty()).toBe(true);
    expect(q.drain(true)).toBeNull();
  });

  it("does not drain while canSpeak is false (gating)", () => {
    const q = createNarrationQueue();
    q.enqueue(item());
    expect(q.drain(false)).toBeNull();
    expect(q.isEmpty()).toBe(false); // still queued
    expect(q.drain(true)).toHaveLength(1);
  });

  it("returns a low batch when only low items are queued", () => {
    const q = createNarrationQueue();
    q.enqueue(item({ text: "a" }));
    q.enqueue(item({ text: "b" }));
    const batch = q.drain(true);
    expect(batch?.map((i) => i.text)).toEqual(["a", "b"]);
    expect(q.isEmpty()).toBe(true);
  });

  it("prioritises high items, leaving low for the next drain", () => {
    const q = createNarrationQueue();
    q.enqueue(item({ priority: "low", kind: "run_output", text: "out" }));
    q.enqueue(item({ priority: "high", kind: "run_blocked", text: "question?" }));
    q.enqueue(item({ priority: "high", kind: "run_failed", text: "boom" }));

    const first = q.drain(true);
    expect(first?.map((i) => i.kind)).toEqual(["run_blocked", "run_failed"]); // both highs, batched
    expect(q.isEmpty()).toBe(false);

    const second = q.drain(true);
    expect(second?.map((i) => i.text)).toEqual(["out"]); // the low, later
    expect(q.isEmpty()).toBe(true);
  });

  it("preserves enqueue order within a batch", () => {
    const q = createNarrationQueue();
    q.enqueue(item({ priority: "high", text: "1" }));
    q.enqueue(item({ priority: "high", text: "2" }));
    q.enqueue(item({ priority: "high", text: "3" }));
    expect(q.drain(true)?.map((i) => i.text)).toEqual(["1", "2", "3"]);
  });
});
