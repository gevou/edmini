/**
 * localStorage-backed RosterStore (edmini-q1e). N named centroids, one principal. Same client-side
 * privacy posture as the single enrollment. Migrates a legacy `tsvad_enrollment` into the principal
 * member so existing users keep their voice.
 */
import type { Enrollment, Roster, RosterMember, RosterStore } from "./types";

const KEY = "tsvad_roster";
const LEGACY_KEY = "tsvad_enrollment";

interface SerEnrollment { centroid: number[]; windowCount: number; dim: number; enrolledAt: number; name?: string }
interface SerMember { id: string; name?: string; enrollment: SerEnrollment }
interface SerRoster { principalId: string | null; members: SerMember[] }

const toEnrollment = (s: SerEnrollment): Enrollment => ({
  centroid: Float32Array.from(s.centroid), windowCount: s.windowCount, dim: s.dim, enrolledAt: s.enrolledAt, name: s.name,
});
const toSer = (e: Enrollment): SerEnrollment => ({
  centroid: Array.from(e.centroid), windowCount: e.windowCount, dim: e.dim, enrolledAt: e.enrolledAt, name: e.name,
});

export function createLocalStorageRosterStore(storageKey = KEY): RosterStore {
  return {
    load(): Roster {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const s = JSON.parse(raw) as SerRoster;
          const members: RosterMember[] = (s.members ?? [])
            .filter((m) => Array.isArray(m.enrollment?.centroid) && m.enrollment.centroid.length === m.enrollment.dim)
            .map((m) => ({ id: m.id, name: m.name, enrollment: toEnrollment(m.enrollment) }));
          return { principalId: s.principalId ?? null, members };
        }
        // Migrate a legacy single enrollment → principal member.
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          const e = JSON.parse(legacy) as SerEnrollment;
          if (Array.isArray(e.centroid) && e.centroid.length === e.dim) {
            return { principalId: "principal", members: [{ id: "principal", name: e.name, enrollment: toEnrollment(e) }] };
          }
        }
      } catch { /* fall through to empty */ }
      return { principalId: null, members: [] };
    },
    save(r: Roster) {
      const s: SerRoster = {
        principalId: r.principalId,
        members: r.members.map((m) => ({ id: m.id, name: m.name, enrollment: toSer(m.enrollment) })),
      };
      localStorage.setItem(storageKey, JSON.stringify(s));
    },
    clear() { localStorage.removeItem(storageKey); },
  };
}
