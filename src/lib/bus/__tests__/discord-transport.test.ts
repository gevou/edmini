import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderOutbound } from "../transport";
import { createDiscordTransport } from "../discord-transport";

describe("renderOutbound", () => {
  it("renders each outbound envelope kind", () => {
    expect(renderOutbound("task_dispatch", { instruction: "deploy the export" })).toBe("deploy the export");
    expect(renderOutbound("answer", { text: "staging" })).toBe("staging");
    expect(renderOutbound("cancel", {})).toBe("⏹ Please stop the current task.");
    expect(renderOutbound("cancel", { reason: "wrong target" })).toBe("⏹ Please stop the current task: wrong target.");
  });
});

describe("createDiscordTransport", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "msg-123" }) });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const t = () => createDiscordTransport({ token: "TOK", channelId: "chan-1" });

  it("dispatch posts the instruction to the channel with the DiscordBot UA + bot auth; runId=messageId", async () => {
    const res = await t().dispatch("schedule the standup");
    expect(res).toEqual({ runId: "msg-123", messageId: "msg-123" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/channels/chan-1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers["User-Agent"]).toMatch(/^DiscordBot /);
    expect(init.headers.Authorization).toBe("Bot TOK");
    expect(JSON.parse(init.body)).toEqual({ content: "schedule the standup" });
  });

  it("answer posts into the run's thread (runId is the channel)", async () => {
    await t().answer("run-9", "use prod");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/channels/run-9/messages");
    expect(JSON.parse(init.body)).toEqual({ content: "use prod" });
  });

  it("cancel posts a stop message into the run's thread", async () => {
    await t().cancel("run-9", "changed my mind");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/channels/run-9/messages");
    expect(JSON.parse(init.body).content).toContain("stop the current task");
  });

  it("throws on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => "error code: 1010" });
    await expect(t().dispatch("x")).rejects.toThrow(/403/);
  });
});
