import { describe, it, expect } from "vitest";
import { legacyThreadFor, type ThreadRecord } from "../threads";

describe("threads pure helpers", () => {
  it("legacy fallback: an unmapped api_identifier resolves to itself as run_id", () => {
    const t: ThreadRecord = legacyThreadFor("discord", "123456789");
    expect(t.runId).toBe("123456789");
    expect(t.apiIdentifier).toBe("123456789");
    expect(t.id).toBe("123456789");
    expect(t.medium).toBe("written");
    expect(t.transport).toBe("discord");
  });
});
