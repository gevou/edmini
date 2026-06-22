import { describe, it, expect, beforeEach } from "vitest";
import { createLocalStorageRosterStore } from "../roster-store";
import type { Enrollment } from "../types";

const enr = (name?: string): Enrollment => ({
  centroid: Float32Array.from([1, 0, 0]), windowCount: 30, dim: 3, enrolledAt: 1, name,
});

// vitest runs in the "node" environment (no DOM), so provide a minimal in-memory localStorage.
beforeEach(() => {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size; },
  } as unknown as Storage;
});

describe("createLocalStorageRosterStore", () => {
  it("returns an empty roster when nothing is stored", () => {
    expect(createLocalStorageRosterStore().load()).toEqual({ principalId: null, members: [] });
  });

  it("round-trips a roster (centroid survives as Float32Array)", () => {
    const store = createLocalStorageRosterStore();
    const r = { principalId: "p", members: [{ id: "p", name: "George", enrollment: enr("George") }] };
    store.save(r);
    const out = createLocalStorageRosterStore().load();
    expect(out.principalId).toBe("p");
    expect(out.members[0].name).toBe("George");
    expect(Array.from(out.members[0].enrollment.centroid)).toEqual([1, 0, 0]);
  });

  it("migrates a legacy single tsvad_enrollment into a principal member", () => {
    localStorage.setItem("tsvad_enrollment", JSON.stringify({
      centroid: [1, 0, 0], windowCount: 30, dim: 3, enrolledAt: 1, name: "George",
    }));
    const out = createLocalStorageRosterStore().load();
    expect(out.principalId).toBe("principal");
    expect(out.members).toHaveLength(1);
    expect(out.members[0].id).toBe("principal");
    expect(out.members[0].name).toBe("George");
    expect(out.members[0].enrollment.dim).toBe(3);
  });
});
