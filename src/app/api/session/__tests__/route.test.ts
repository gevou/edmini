import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
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
