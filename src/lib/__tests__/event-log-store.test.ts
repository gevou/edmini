/**
 * Unit tests for the event-log store mirror.
 *
 * The store is a module-level singleton acting as a client-side mirror of the
 * server event log. In production, writes go through HTTP and reads come back
 * via SSE. For unit testing, we use the `_unsafeForTestPushLocal` /
 * `_unsafeForTestReset` escape hatches to populate the mirror synchronously —
 * the network layer is exercised in integration tests, not here.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _unsafeForTestPushLocal,
  _unsafeForTestReset,
  getEntriesSnapshot,
  subscribeToEvents,
} from "../event-log-store";

describe("event-log-store (client mirror)", () => {
  beforeEach(() => {
    _unsafeForTestReset();
  });

  afterEach(() => {
    _unsafeForTestReset();
  });

  describe("_unsafeForTestPushLocal + getEntriesSnapshot", () => {
    it("starts empty after a reset", () => {
      expect(getEntriesSnapshot()).toHaveLength(0);
    });

    it("appends a new entry on push", () => {
      _unsafeForTestPushLocal({ kind: "info", label: "first" });
      const entries = getEntriesSnapshot();
      expect(entries).toHaveLength(1);
      expect(entries[0].label).toBe("first");
      expect(entries[0].kind).toBe("info");
    });

    it("assigns a unique id and a numeric timestamp to each entry", () => {
      _unsafeForTestPushLocal({ kind: "info", label: "a" });
      _unsafeForTestPushLocal({ kind: "info", label: "b" });
      const [a, b] = getEntriesSnapshot();
      expect(a.id).toBeTruthy();
      expect(b.id).toBeTruthy();
      expect(a.id).not.toBe(b.id);
      expect(typeof a.timestamp).toBe("number");
      expect(typeof b.timestamp).toBe("number");
    });

    it("preserves order of pushes", () => {
      _unsafeForTestPushLocal({ kind: "info", label: "1" });
      _unsafeForTestPushLocal({ kind: "info", label: "2" });
      _unsafeForTestPushLocal({ kind: "info", label: "3" });
      expect(getEntriesSnapshot().map((e) => e.label)).toEqual(["1", "2", "3"]);
    });

    it("preserves optional fields (detail, payload) when provided", () => {
      _unsafeForTestPushLocal({
        kind: "classified",
        label: "x",
        detail: "transcript",
        payload: { confidence: 0.9 },
      });
      const [entry] = getEntriesSnapshot();
      expect(entry.detail).toBe("transcript");
      expect(entry.payload).toEqual({ confidence: 0.9 });
    });

    it("returns a new array reference after each push (snapshot immutability)", () => {
      _unsafeForTestPushLocal({ kind: "info", label: "a" });
      const before = getEntriesSnapshot();
      _unsafeForTestPushLocal({ kind: "info", label: "b" });
      const after = getEntriesSnapshot();
      expect(before).not.toBe(after);
      expect(before).toHaveLength(1);
      expect(after).toHaveLength(2);
    });

    it("generates a unique id per push so independent calls don't collide", () => {
      const a = _unsafeForTestPushLocal({ kind: "info", label: "once" });
      const b = _unsafeForTestPushLocal({ kind: "info", label: "once" });
      expect(a.id).not.toBe(b.id);
      expect(getEntriesSnapshot()).toHaveLength(2);
    });
  });

  describe("subscribeToEvents", () => {
    it("invokes the callback on each push", () => {
      let count = 0;
      const unsubscribe = subscribeToEvents(() => {
        count += 1;
      });
      _unsafeForTestPushLocal({ kind: "info", label: "a" });
      _unsafeForTestPushLocal({ kind: "info", label: "b" });
      expect(count).toBe(2);
      unsubscribe();
    });

    it("stops invoking after unsubscribe", () => {
      let count = 0;
      const unsubscribe = subscribeToEvents(() => {
        count += 1;
      });
      _unsafeForTestPushLocal({ kind: "info", label: "a" });
      unsubscribe();
      _unsafeForTestPushLocal({ kind: "info", label: "b" });
      expect(count).toBe(1);
    });
  });

  describe("_unsafeForTestReset", () => {
    it("empties the mirror", () => {
      _unsafeForTestPushLocal({ kind: "info", label: "a" });
      _unsafeForTestPushLocal({ kind: "info", label: "b" });
      expect(getEntriesSnapshot()).toHaveLength(2);
      _unsafeForTestReset();
      expect(getEntriesSnapshot()).toHaveLength(0);
    });
  });
});
