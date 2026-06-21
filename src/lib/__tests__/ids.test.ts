import { describe, it, expect } from "vitest";
import { mintRunId, mintThreadId, RUN_PREFIX, THREAD_PREFIX } from "../ids";

describe("ids", () => {
  it("mints prefixed, unique run ids", () => {
    const a = mintRunId(), b = mintRunId();
    expect(a.startsWith(RUN_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(RUN_PREFIX.length + 30);
  });
  it("mints prefixed, unique thread ids", () => {
    const a = mintThreadId();
    expect(a.startsWith(THREAD_PREFIX)).toBe(true);
    expect(mintThreadId()).not.toBe(a);
  });
});
