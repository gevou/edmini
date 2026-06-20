import { describe, it, expect, vi, beforeEach } from "vitest";

const { dispatch, answer, cancel, append } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  answer: vi.fn(),
  cancel: vi.fn(),
  append: vi.fn(),
}));

vi.mock("@/lib/bus/discord-transport", () => ({
  discordTransportFromEnv: () => ({ dispatch, answer, cancel }),
}));
vi.mock("@/lib/ledger-supabase", () => ({
  ledgerFromEnv: () => ({ append }),
}));

import { POST } from "../route";

const req = (body: unknown) =>
  new Request("http://localhost/api/bus", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  dispatch.mockReset();
  answer.mockReset();
  cancel.mockReset();
  append.mockReset();
});

describe("POST /api/bus", () => {
  it("dispatch → creates a run, logs task_dispatch with label, returns runId", async () => {
    dispatch.mockResolvedValue({ runId: "r1" });
    const res = await POST(req({ action: "dispatch", instruction: "deploy the export", label: "export" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runId: "r1" });
    expect(dispatch).toHaveBeenCalledWith("deploy the export");
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "r1",
        source: "edmini",
        kind: "task_dispatch",
        payload: { instruction: "deploy the export", label: "export" },
      }),
    );
  });

  it("dispatch without a label persists label: null", async () => {
    dispatch.mockResolvedValue({ runId: "r2" });
    await POST(req({ action: "dispatch", instruction: "look something up" }));
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { instruction: "look something up", label: null } }),
    );
  });

  it("answer → transport.answer + logs", async () => {
    const res = await POST(req({ action: "answer", runId: "r1", text: "staging" }));
    expect(res.status).toBe(200);
    expect(answer).toHaveBeenCalledWith("r1", "staging");
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ runId: "r1", kind: "answer" }));
  });

  it("cancel → transport.cancel + logs", async () => {
    const res = await POST(req({ action: "cancel", runId: "r1", reason: "nvm" }));
    expect(res.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith("r1", "nvm");
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ runId: "r1", kind: "cancel" }));
  });

  it("validates required fields", async () => {
    expect((await POST(req({ action: "dispatch" }))).status).toBe(400);
    expect((await POST(req({ action: "answer", runId: "r1" }))).status).toBe(400);
    expect((await POST(req({ action: "cancel" }))).status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
