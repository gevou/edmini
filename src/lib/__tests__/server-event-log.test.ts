/**
 * Unit tests for the server-side event log.
 *
 * This is the canonical store — pure module-level singleton with no HTTP or
 * React dependencies. Tests reset between cases with clearServerEvents().
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearServerEvents,
  getServerEntriesSnapshot,
  pushServerEvent,
  subscribeServer,
  subscribeServerClear,
} from "../server-event-log";

describe("server-event-log", () => {
  beforeEach(() => {
    clearServerEvents();
  });

  afterEach(() => {
    clearServerEvents();
  });

  describe("pushServerEvent", () => {
    it("returns the stored entry with id + timestamp filled in", () => {
      const stored = pushServerEvent({ kind: "info", label: "x" });
      expect(stored.id).toBeTruthy();
      expect(typeof stored.timestamp).toBe("number");
      expect(stored.label).toBe("x");
      expect(stored.kind).toBe("info");
    });

    it("appends to the snapshot in order", () => {
      pushServerEvent({ kind: "info", label: "a" });
      pushServerEvent({ kind: "info", label: "b" });
      pushServerEvent({ kind: "info", label: "c" });
      expect(getServerEntriesSnapshot().map((e) => e.label)).toEqual([
        "a",
        "b",
        "c",
      ]);
    });

    it("assigns unique ids across pushes", () => {
      const a = pushServerEvent({ kind: "info", label: "a" });
      const b = pushServerEvent({ kind: "info", label: "b" });
      expect(a.id).not.toBe(b.id);
    });

    it("preserves optional fields", () => {
      pushServerEvent({
        kind: "classified",
        label: "x",
        detail: "transcript snippet",
        payload: { confidence: 0.9 },
      });
      const [entry] = getServerEntriesSnapshot();
      expect(entry.detail).toBe("transcript snippet");
      expect(entry.payload).toEqual({ confidence: 0.9 });
    });
  });

  describe("subscribeServer", () => {
    it("fires the callback for each pushed event with the stored entry", () => {
      const seen: string[] = [];
      const unsubscribe = subscribeServer((entry) => {
        seen.push(entry.label);
      });
      pushServerEvent({ kind: "info", label: "a" });
      pushServerEvent({ kind: "info", label: "b" });
      expect(seen).toEqual(["a", "b"]);
      unsubscribe();
    });

    it("does NOT replay history on subscribe", () => {
      pushServerEvent({ kind: "info", label: "pre-existing" });
      const seen: string[] = [];
      const unsubscribe = subscribeServer((entry) => {
        seen.push(entry.label);
      });
      expect(seen).toEqual([]);
      pushServerEvent({ kind: "info", label: "after-subscribe" });
      expect(seen).toEqual(["after-subscribe"]);
      unsubscribe();
    });

    it("stops firing after unsubscribe", () => {
      let count = 0;
      const unsubscribe = subscribeServer(() => {
        count += 1;
      });
      pushServerEvent({ kind: "info", label: "a" });
      unsubscribe();
      pushServerEvent({ kind: "info", label: "b" });
      expect(count).toBe(1);
    });

    it("supports multiple concurrent subscribers (fan-out)", () => {
      let aCount = 0;
      let bCount = 0;
      const unsubA = subscribeServer(() => {
        aCount += 1;
      });
      const unsubB = subscribeServer(() => {
        bCount += 1;
      });
      pushServerEvent({ kind: "info", label: "fanout" });
      expect(aCount).toBe(1);
      expect(bCount).toBe(1);
      unsubA();
      unsubB();
    });

    it("isolates a throwing subscriber so others still fire", () => {
      let bFired = false;
      const unsubA = subscribeServer(() => {
        throw new Error("boom");
      });
      const unsubB = subscribeServer(() => {
        bFired = true;
      });
      // Should not throw despite subscriber A blowing up.
      expect(() =>
        pushServerEvent({ kind: "info", label: "still-fires" }),
      ).not.toThrow();
      expect(bFired).toBe(true);
      unsubA();
      unsubB();
    });
  });

  describe("clearServerEvents + subscribeServerClear", () => {
    it("empties the store", () => {
      pushServerEvent({ kind: "info", label: "a" });
      pushServerEvent({ kind: "info", label: "b" });
      expect(getServerEntriesSnapshot()).toHaveLength(2);
      clearServerEvents();
      expect(getServerEntriesSnapshot()).toHaveLength(0);
    });

    it("notifies clear-subscribers", () => {
      let cleared = 0;
      const unsubscribe = subscribeServerClear(() => {
        cleared += 1;
      });
      clearServerEvents();
      expect(cleared).toBe(1);
      unsubscribe();
    });

    it("does NOT notify event-subscribers on clear", () => {
      let events = 0;
      const unsubscribe = subscribeServer(() => {
        events += 1;
      });
      pushServerEvent({ kind: "info", label: "a" });
      expect(events).toBe(1);
      clearServerEvents();
      expect(events).toBe(1); // unchanged
      unsubscribe();
    });
  });
});
