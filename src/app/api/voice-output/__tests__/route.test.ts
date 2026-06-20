import { describe, it, expect, vi, beforeEach } from "vitest";

const { append } = vi.hoisted(() => ({ append: vi.fn() }));

vi.mock("@/lib/ledger-supabase", () => ({
  ledgerFromEnv: () => ({ append }),
}));

import { POST } from "../route";

const req = (body: unknown) =>
  new Request("http://localhost/api/voice-output", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => append.mockReset());

describe("POST /api/voice-output", () => {
  it("logs a voice_output ledger event (source edmini)", async () => {
    const res = await POST(req({ text: "That's 400." }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(append).toHaveBeenCalledWith({
      runId: null,
      source: "edmini",
      kind: "voice_output",
      payload: { text: "That's 400." },
    });
  });

  it("carries runId when provided", async () => {
    await POST(req({ text: "Done.", runId: "r1" }));
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ runId: "r1", kind: "voice_output" }));
  });

  it("rejects empty/missing text without writing", async () => {
    expect((await POST(req({ text: "   " }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
    expect(append).not.toHaveBeenCalled();
  });
});
