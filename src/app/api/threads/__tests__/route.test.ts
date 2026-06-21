import { describe, it, expect, vi, beforeEach } from "vitest";

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));

vi.mock("@/lib/threads", () => ({
  threadStoreFromEnv: () => ({ insert }),
}));

vi.mock("@/lib/ids", () => ({
  mintThreadId: () => "thr_test-id",
}));

import { POST } from "../route";

const req = (body: unknown) =>
  new Request("http://localhost/api/threads", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => insert.mockReset());

describe("POST /api/threads", () => {
  it("returns 400 when medium is invalid", async () => {
    const res = await POST(req({ medium: "smoke-signal", transport: "openai-realtime", apiIdentifier: "sess_123" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch("medium must be voice|written");
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns 400 when transport is missing", async () => {
    const res = await POST(req({ medium: "voice", apiIdentifier: "sess_123" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch("transport and apiIdentifier required");
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns 400 when apiIdentifier is missing", async () => {
    const res = await POST(req({ medium: "voice", transport: "openai-realtime" }));
    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("happy path: inserts and returns threadId", async () => {
    insert.mockResolvedValue({ id: "thr_test-id", medium: "voice", transport: "openai-realtime", apiIdentifier: "sess_abc", runId: null, topicId: null });
    const res = await POST(req({ medium: "voice", transport: "openai-realtime", apiIdentifier: "sess_abc", runId: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ threadId: "thr_test-id" });
    expect(insert).toHaveBeenCalledWith({
      id: "thr_test-id",
      medium: "voice",
      transport: "openai-realtime",
      apiIdentifier: "sess_abc",
      runId: null,
      topicId: null,
    });
  });
});
