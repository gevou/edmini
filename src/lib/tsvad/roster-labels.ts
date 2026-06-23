/**
 * Display labels for roster voices (edmini-mfl). Pure; no React.
 *
 * A roster member's name is optional (the enrollment name step can be skipped), so the UI needs a
 * stable fallback instead of showing "you" / a raw id. We use "Speaker N" by 1-based position in the
 * roster — predictable and good enough for a display fallback (removing a voice renumbers the rest).
 *
 * The manual name is the FIRST source of a member's name; once edmini gains login (edmini-epn) an
 * SSO-derived identity can layer above it. This helper only decides what to SHOW, not where the name
 * comes from.
 */
import type { Roster, RosterMember } from "./types";

/** The name to display for a roster member: its name if set, else "Speaker N" (1-based position). */
export function rosterMemberLabel(member: RosterMember, roster: Roster): string {
  const name = member.name?.trim();
  if (name) return name;
  const idx = roster.members.findIndex((m) => m.id === member.id);
  const position = idx >= 0 ? idx + 1 : roster.members.length + 1;
  return `Speaker ${position}`;
}
