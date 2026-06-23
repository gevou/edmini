import { describe, it, expect } from "vitest";
import { rosterMemberLabel } from "../roster-labels";
import type { Enrollment, Roster, RosterMember } from "../types";

const enr = (name?: string): Enrollment => ({
  centroid: Float32Array.from([1, 0, 0]), windowCount: 1, dim: 3, enrolledAt: 1, name,
});
const member = (id: string, name?: string): RosterMember => ({ id, name, enrollment: enr(name) });
const roster = (...ms: RosterMember[]): Roster => ({ principalId: ms[0]?.id ?? null, members: ms });

describe("rosterMemberLabel", () => {
  it("returns the member's name when set", () => {
    const r = roster(member("principal", "George"));
    expect(rosterMemberLabel(r.members[0], r)).toBe("George");
  });

  it("falls back to 'Speaker N' by 1-based position when unnamed", () => {
    const r = roster(member("principal"), member("m2"), member("m3", "Roger"));
    expect(rosterMemberLabel(r.members[0], r)).toBe("Speaker 1");
    expect(rosterMemberLabel(r.members[1], r)).toBe("Speaker 2");
    expect(rosterMemberLabel(r.members[2], r)).toBe("Roger"); // a named member keeps its name mid-list
  });

  it("treats a blank/whitespace name as unnamed", () => {
    const r = roster(member("principal", "   "));
    expect(rosterMemberLabel(r.members[0], r)).toBe("Speaker 1");
  });

  it("renumbers by position after a removal", () => {
    const r = roster(member("m2"), member("m3")); // principal removed; positions shift
    expect(rosterMemberLabel(r.members[0], r)).toBe("Speaker 1");
    expect(rosterMemberLabel(r.members[1], r)).toBe("Speaker 2");
  });

  it("is defensive when the member isn't in the roster", () => {
    const r = roster(member("principal", "George"));
    expect(rosterMemberLabel(member("ghost"), r)).toBe("Speaker 2");
  });
});
