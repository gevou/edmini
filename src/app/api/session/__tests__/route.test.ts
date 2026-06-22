import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/ledger-supabase", () => ({
  ledgerFromEnv: () => ({
    snapshot: vi.fn().mockResolvedValue([
      { seq: 1, runId: null, source: "user", kind: "user_utterance", payload: { text: "export the board" } },
      { seq: 2, runId: "run_a", source: "edmini", kind: "task_dispatch", payload: { label: "export" } },
      { seq: 3, runId: "run_a", source: "edmini", kind: "voice_output", payload: { text: "on it" } },
    ]),
    append: vi.fn(),
    subscribe: vi.fn(),
  }),
}));

import { POST } from "../route";

function bodyOf(call: number) { return JSON.parse(fetchMock.mock.calls[call][1].body); }

describe("POST /api/session grading flag", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ value: "ek" }) });
    process.env.OPENAI_API_KEY = "sk-test";
  });
  it("omits create_response by default (auto-response on)", async () => {
    await POST(new Request("http://t/api/session", { method: "POST", body: JSON.stringify({}) }));
    expect(bodyOf(0).session.audio.input.turn_detection.create_response).toBeUndefined();
  });
  it("sets create_response:false when grading is requested", async () => {
    await POST(new Request("http://t/api/session", { method: "POST", body: JSON.stringify({ grading: true }) }));
    expect(bodyOf(0).session.audio.input.turn_detection.create_response).toBe(false);
  });
});

describe("POST /api/session recent history + search_history tool", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ value: "ek" }) });
    process.env.OPENAI_API_KEY = "sk-test";
  });
  it("injects a Recent history block and a search_history tool", async () => {
    const res = await POST(new Request("http://t/api/session", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }));
    expect(res.status).toBe(200);
    const sent = bodyOf(fetchMock.mock.calls.length - 1);
    expect(sent.session.instructions).toContain("Recent history");
    expect(sent.session.instructions).toContain("export the board");
    expect(sent.session.tools.some((t: { name: string }) => t.name === "search_history")).toBe(true);
  });
});
