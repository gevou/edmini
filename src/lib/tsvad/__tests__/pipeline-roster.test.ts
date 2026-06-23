import { describe, it, expect } from "vitest";
import { scoreWindow, selectPrincipal } from "../pipeline";

const m = (id: string, c: number[]) => ({ id, enrollment: { centroid: Float32Array.from(c) } });

describe("scoreWindow", () => {
  it("single principal member → raw is that member's cosine (back-compat)", () => {
    const { scores, raw } = scoreWindow(Float32Array.from([1, 0]), [m("p", [1, 0])], "p");
    expect(scores).toHaveLength(1);
    expect(raw).toBeCloseTo(1, 5);
  });
  it("multi-member → raw is the PRINCIPAL's cosine, scores carry all", () => {
    const emb = Float32Array.from([1, 0]);
    const { scores, raw } = scoreWindow(emb, [m("p", [1, 0]), m("r", [0, 1])], "p");
    expect(scores.map((s) => s.id)).toEqual(["p", "r"]);
    expect(raw).toBeCloseTo(1, 5);              // principal
    expect(scores.find((s) => s.id === "r")!.cosine).toBeCloseTo(0, 5);
  });
  it("no members → raw null, empty scores", () => {
    expect(scoreWindow(Float32Array.from([1]), [], null)).toEqual({ scores: [], raw: null });
  });
});

const member = (id: string) => ({
  id,
  name: id,
  enrollment: { centroid: Float32Array.from([1, 0]), windowCount: 1, dim: 2, enrolledAt: 0 },
});

describe("selectPrincipal", () => {
  it("principalId: null with members present → returns null (no silent promotion)", () => {
    const r = { principalId: null, members: [member("a"), member("b")] };
    expect(selectPrincipal(r)).toBeNull();
  });

  it("principalId present and found → returns that member", () => {
    const m = member("p");
    const r = { principalId: "p", members: [member("a"), m] };
    expect(selectPrincipal(r)).toBe(m);
  });

  it("principalId present but NOT in members → returns null (never promote another)", () => {
    const r = { principalId: "missing", members: [member("a"), member("b")] };
    expect(selectPrincipal(r)).toBeNull();
  });

  it("empty roster → null", () => {
    expect(selectPrincipal({ principalId: null, members: [] })).toBeNull();
  });
});
