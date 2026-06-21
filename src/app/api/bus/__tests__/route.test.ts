import { describe, it, expect, vi, beforeEach } from "vitest";

const { dispatch, answer, cancel, append, threadsInsert, threadsByRunId } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  answer: vi.fn(),
  cancel: vi.fn(),
  append: vi.fn(),
  threadsInsert: vi.fn(),
  threadsByRunId: vi.fn(),
}));

vi.mock("@/lib/bus/discord-transport", () => ({
  discordTransportFromEnv: () => ({ dispatch, answer, cancel }),
}));
vi.mock("@/lib/ledger-supabase", () => ({
  ledgerFromEnv: () => ({ append }),
}));
vi.mock("@/lib/threads", () => ({
  threadStoreFromEnv: () => ({
    insert: threadsInsert,
    byRunId: threadsByRunId,
    byApiIdentifier: vi.fn(),
  }),
}));

import { POST } from "../route";

const req = (body: unknown) =>
  new Request("http://localhost/api/bus", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  dispatch.mockReset();
  answer.mockReset();
  cancel.mockReset();
  append.mockReset();
  threadsInsert.mockReset();
  threadsByRunId.mockReset();
  // default: threadsInsert resolves, byRunId returns a thread with apiIdentifier T1
  threadsInsert.mockResolvedValue({});
  threadsByRunId.mockResolvedValue({ id: "thr_x", apiIdentifier: "T1", medium: "written", transport: "discord", runId: "run_x", topicId: null });
});

describe("POST /api/bus", () => {
  it("dispatch → mints run_/thr_ ids, writes threads row, logs task_dispatch, returns runId", async () => {
    dispatch.mockResolvedValue({ apiIdentifier: "T1", messageApiId: "M1" });
    const res = await POST(req({ action: "dispatch", instruction: "deploy the export", label: "export", prevRunId: "run_old" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runId).toMatch(/^run_/);
    expect(dispatch).toHaveBeenCalledWith("deploy the export");
    // threads.insert called with correct fields
    expect(threadsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        medium: "written",
        transport: "discord",
        apiIdentifier: "T1",
        runId: expect.stringMatching(/^run_/),
      }),
    );
    // ledger append carries threadId, prevRunId, apiIdentifier
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: expect.stringMatching(/^run_/),
        threadId: expect.stringMatching(/^thr_/),
        source: "edmini",
        kind: "task_dispatch",
        payload: expect.objectContaining({
          instruction: "deploy the export",
          label: "export",
          prevRunId: "run_old",
          apiIdentifier: "M1",
        }),
      }),
    );
  });

  it("dispatch without label/prevRunId persists null", async () => {
    dispatch.mockResolvedValue({ apiIdentifier: "T1", messageApiId: "M1" });
    await POST(req({ action: "dispatch", instruction: "look something up" }));
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ instruction: "look something up", label: null, prevRunId: null }),
      }),
    );
  });

  it("answer → resolves apiIdentifier via threads, calls transport.answer, logs", async () => {
    const res = await POST(req({ action: "answer", runId: "run_abc", text: "staging" }));
    expect(res.status).toBe(200);
    expect(answer).toHaveBeenCalledWith("T1", "staging");
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_abc", kind: "answer" }));
  });

  it("cancel → resolves apiIdentifier via threads, calls transport.cancel, logs", async () => {
    const res = await POST(req({ action: "cancel", runId: "run_abc", reason: "nvm" }));
    expect(res.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith("T1", "nvm");
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_abc", kind: "cancel" }));
  });

  it("cancel/answer fall back to runId as apiIdentifier when no threads row exists", async () => {
    threadsByRunId.mockResolvedValue(null);
    await POST(req({ action: "answer", runId: "legacy-snowflake", text: "ok" }));
    expect(answer).toHaveBeenCalledWith("legacy-snowflake", "ok");
  });

  it("validates required fields", async () => {
    expect((await POST(req({ action: "dispatch" }))).status).toBe(400);
    expect((await POST(req({ action: "answer", runId: "r1" }))).status).toBe(400);
    expect((await POST(req({ action: "cancel" }))).status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
