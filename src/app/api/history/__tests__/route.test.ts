import { describe, it, expect, vi, beforeEach } from "vitest";

const { snapshot } = vi.hoisted(() => ({
  snapshot: vi.fn().mockResolvedValue([{ seq: 1, runId: "run_a", source: "user", kind: "user_utterance", payload: { text: "hi" } }]),
}));

vi.mock("@/lib/ledger-supabase", () => ({
  ledgerFromEnv: () => ({ snapshot, append: vi.fn(), subscribe: vi.fn() }),
}));

import { POST } from "../route";

const post = (body: unknown) =>
  POST(new Request("http://t/api/history", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));

describe("POST /api/history", () => {
  beforeEach(() => snapshot.mockClear());

  it("maps params to snapshot opts and returns raw events", async () => {
    const res = await post({ runId: "run_a", text: "export", limit: 5 });
    const json = await res.json();
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_a", text: "export", limit: 5 }));
    expect(json.events).toHaveLength(1);
  });

  it("caps limit at 100 and defaults to 30", async () => {
    await post({ limit: 9999 });
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    await post({});
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ limit: 30 }));
  });

  it("ignores unsupported params (e.g. to) without error", async () => {
    const res = await post({ to: "someone", since: "2026-06-01T00:00:00Z" });
    expect(res.status).toBe(200);
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ since: "2026-06-01T00:00:00Z" }));
    expect(snapshot.mock.calls[0][0]).not.toHaveProperty("to");
  });
});
