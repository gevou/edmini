import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { interpret } from "../interpret";

const fixtures = JSON.parse(
  readFileSync("src/lib/bus/__fixtures__/hermes-messages.json", "utf8"),
) as Array<{ hermes: string | null; kind: string | null }>;

describe("interpret — against captured Hermes fixtures", () => {
  for (const f of fixtures) {
    if (!f.hermes || !f.kind) continue;
    it(`classifies "${f.hermes.slice(0, 36)}…" → ${f.kind}`, async () => {
      const r = await interpret(f.hermes!);
      expect(r.kind).toBe(f.kind);
    });
  }
});

describe("interpret — specifics", () => {
  it("strips the clarify prefix into payload.question (marker)", async () => {
    const r = await interpret('❓ clarify: "staging or prod?"');
    expect(r.kind).toBe("run_blocked");
    expect(r.via).toBe("marker");
    expect(r.payload.question).toBe('"staging or prod?"');
  });

  it("treats ⏳ heartbeats as ignore", async () => {
    const r = await interpret("⏳ Still working... (3 min elapsed — iteration 2/90)");
    expect(r.kind).toBe("ignore");
    expect(r.via).toBe("marker");
  });

  it("maps ⚠️ / shutdown to run_failed", async () => {
    expect((await interpret("⚠️ Gateway shutting down — task interrupted.")).kind).toBe("run_failed");
  });

  it("defaults plain text to run_output when no LLM is provided", async () => {
    const r = await interpret("The answer is 731.");
    expect(r).toMatchObject({ kind: "run_output", via: "default" });
    expect(r.payload.text).toBe("The answer is 731.");
  });

  it("uses the injected LLM for plain text and shapes the payload", async () => {
    const llm = vi.fn().mockResolvedValue({ kind: "run_done", confidence: 0.9 });
    const r = await interpret("All set — deployed to staging.", llm);
    expect(llm).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ kind: "run_done", via: "llm", confidence: 0.9 });
    expect(r.payload.summary).toBe("All set — deployed to staging.");
  });
});
