import { describe, it, expect, vi, beforeEach } from "vitest";

const append = vi.fn();
vi.mock("@/lib/ledger-supabase", () => ({ ledgerFromEnv: () => ({ append }) }));

import { POST } from "../route";

function req(body: unknown) {
  return new Request("http://test/api/heard", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/heard", () => {
  beforeEach(() => append.mockReset().mockResolvedValue({}));
  it("appends a heard event (source user, kind heard) with confidence + text", async () => {
    const res = await POST(req({ text: "is dinner ready", confidence: 0.12, threadId: "thr_1" }));
    expect(res.status).toBe(200);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      source: "user", kind: "heard", threadId: "thr_1",
      payload: expect.objectContaining({ text: "is dinner ready", confidence: 0.12 }),
    }));
  });
  it("400 on invalid JSON", async () => {
    const bad = new Request("http://test/api/heard", { method: "POST", body: "{not json" });
    expect((await POST(bad)).status).toBe(400);
  });
});
