import { describe, it, expect, vi, beforeEach } from "vitest";

const { append } = vi.hoisted(() => ({ append: vi.fn() }));

vi.mock("@/lib/ledger-supabase", () => ({
  ledgerFromEnv: () => ({ append, snapshot: vi.fn(), subscribe: vi.fn() }),
}));

import { POST } from "../route";

const post = (body: unknown) =>
  POST(new Request("http://t/api/conversation/utterance", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));

describe("POST /api/conversation/utterance", () => {
  beforeEach(() => append.mockClear());

  it("appends a user_utterance event", async () => {
    const res = await post({ text: "do the export", threadId: "thr_1" });
    expect(res.status).toBe(200);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      source: "user", kind: "user_utterance", threadId: "thr_1",
      payload: { text: "do the export" },
    }));
  });

  it("400s on empty text and does not append", async () => {
    const res = await post({ text: "  " });
    expect(res.status).toBe(400);
    expect(append).not.toHaveBeenCalled();
  });
});
