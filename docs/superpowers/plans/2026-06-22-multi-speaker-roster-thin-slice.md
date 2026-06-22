# Multi-Speaker Roster (manual, identify-only) — Thin Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user manually enroll multiple named voices into a roster; live-attribute each spoken turn to a name (or "unknown"); **leave the respond/suppress gate exactly as today** (Ed still acts only on the principal).

**Architecture:** Today the TS-VAD pipeline cosines each window's embedding against ONE enrolled centroid → drives the gate → emits a `ScoreEvent`. This slice generalizes the held enrollment to a **roster** (N named members, one marked principal): embed the window once (unchanged), cosine to *each* member (N≈free), keep the **principal's** cosine as `raw` (so the gate decision is bit-identical), and emit the per-member scores too. In `VoiceAgent`, a `SpeakerClassifier` runs alongside the existing `UtteranceGrader`: the grader (principal score) still decides respond/suppress; the classifier (all scores) attributes a name at turn-end for display. UI gains "add another voice" + a roster view + the attributed name on turns.

**Tech Stack:** TypeScript, React (client), Web Audio (the VAD pipeline), Vitest. No server changes.

**Spec / decisions:** `docs/architecture/speaker-identity-roadmap.md` + `edmini-q1e` (reframed 2026-06-22: manual entry, **identify-only**). Reuses `src/lib/tsvad/speaker-classifier.ts` (built in `edmini-ce9`).

## Global Constraints

- **Back-compat invariant (load-bearing):** with **only the principal** in the roster, behavior is **identical to today** — same `raw`, same gate decisions, same `ScoreEvent` shape consumers already read. Pin this with a test. (Mirrors `edmini-5y7`'s "grading-off == unchanged".)
- **Identify-only:** the respond/suppress gate uses **only the principal's** score (the existing `UtteranceGrader`). The classifier is for *labeling*, never for gating. Do NOT change `utterance-grader.ts` or the committed-handler respond/suppress logic.
- **Embed once:** never embed a window more than once per hop; cosine to each centroid from the single embedding.
- **Uncertain → "unknown":** attribution uses `speaker-classifier.ts` (top1 ≥ absThr AND top1−top2 ≥ margin), never guesses.
- **Privacy unchanged:** roster centroids stay in `localStorage` (same posture as the single enrollment). No server.
- **`name` may be absent/duplicate:** a roster member's stable key is its `id` (generated), not its name. Display uses `name ?? id`.
- Verify (no server/Realtime in unit tests): `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`. Do NOT run `pnpm lint` (unconfigured stub — hangs). Client-integration tasks (VoiceAgent/UI) verify via tsc+build + on-device, since the component has no unit harness.
- Commit after each task; messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/tsvad/types.ts` | + `RosterMember`, `Roster` types | 1 |
| `src/lib/tsvad/roster-store.ts` (new) | localStorage roster: load/save + migrate legacy single enrollment → principal | 1 |
| `src/lib/tsvad/__tests__/roster-store.test.ts` (new) | store + migration tests | 1 |
| `src/lib/tsvad/pipeline.ts` | hold a roster; cosine vs each member; principal drives gate; emit `scores` | 2 |
| `src/lib/tsvad/__tests__/pipeline-roster.test.ts` (new) | back-compat + multi-member scoring (via a fake embedder) | 2 |
| `src/lib/tsvad/index.ts` | export roster store + types | 1 |
| `src/components/VoiceAgent.tsx` | classifier accumulator → attributed name on turns; "add another voice"; roster view | 3, 4 |
| `src/lib/tsvad/ui/VoiceEnrollment.tsx` | reused as-is for adding a member (name step already exists) | 4 |

---

### Task 1: Roster types + store (with legacy migration)

**Files:**
- Modify: `src/lib/tsvad/types.ts`, `src/lib/tsvad/index.ts`
- Create: `src/lib/tsvad/roster-store.ts`, `src/lib/tsvad/__tests__/roster-store.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // types.ts
  export interface RosterMember { id: string; name?: string; enrollment: Enrollment }
  export interface Roster { principalId: string | null; members: RosterMember[] }
  export interface RosterStore {
    load(): Roster;                 // never null — empty roster {principalId:null, members:[]} if none
    save(r: Roster): void;
    clear(): void;
  }
  ```
  - `createLocalStorageRosterStore(storageKey?: string): RosterStore` (new file). Key `"tsvad_roster"`.
  - **Migration:** on `load()`, if no `tsvad_roster` but a legacy `tsvad_enrollment` exists (the single-enrollment key), wrap it as `{ principalId: "principal", members: [{ id: "principal", name: <its name>, enrollment }] }` and return it (do not delete the legacy key — leave it for rollback).
- Consumes: `Enrollment` (types.ts); the legacy serialization shape from `enrollment-store.ts` (centroid as `number[]`).

- [ ] **Step 1: Write the failing test** — `src/lib/tsvad/__tests__/roster-store.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createLocalStorageRosterStore } from "../roster-store";
import type { Enrollment } from "../types";

const enr = (name?: string): Enrollment => ({
  centroid: Float32Array.from([1, 0, 0]), windowCount: 30, dim: 3, enrolledAt: 1, name,
});

// vitest runs in the "node" environment (no DOM), so provide a minimal in-memory localStorage.
beforeEach(() => {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size; },
  } as unknown as Storage;
});

describe("createLocalStorageRosterStore", () => {
  it("returns an empty roster when nothing is stored", () => {
    expect(createLocalStorageRosterStore().load()).toEqual({ principalId: null, members: [] });
  });

  it("round-trips a roster (centroid survives as Float32Array)", () => {
    const store = createLocalStorageRosterStore();
    const r = { principalId: "p", members: [{ id: "p", name: "George", enrollment: enr("George") }] };
    store.save(r);
    const out = createLocalStorageRosterStore().load();
    expect(out.principalId).toBe("p");
    expect(out.members[0].name).toBe("George");
    expect(Array.from(out.members[0].enrollment.centroid)).toEqual([1, 0, 0]);
  });

  it("migrates a legacy single tsvad_enrollment into a principal member", () => {
    localStorage.setItem("tsvad_enrollment", JSON.stringify({
      centroid: [1, 0, 0], windowCount: 30, dim: 3, enrolledAt: 1, name: "George",
    }));
    const out = createLocalStorageRosterStore().load();
    expect(out.principalId).toBe("principal");
    expect(out.members).toHaveLength(1);
    expect(out.members[0].id).toBe("principal");
    expect(out.members[0].name).toBe("George");
    expect(out.members[0].enrollment.dim).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test src/lib/tsvad/__tests__/roster-store.test.ts` → FAIL (module not found).

- [ ] **Step 3: Add the types** to `src/lib/tsvad/types.ts` (after the `Enrollment` interface):

```typescript
/** One enrolled voice in the roster: a stable id, an optional display name, and its centroid. */
export interface RosterMember {
  id: string;
  name?: string;
  enrollment: Enrollment;
}

/** The set of enrolled voices. `principalId` names the member whose turns Ed acts on (identify-only). */
export interface Roster {
  principalId: string | null;
  members: RosterMember[];
}

export interface RosterStore {
  load(): Roster;
  save(r: Roster): void;
  clear(): void;
}
```

- [ ] **Step 4: Implement the store** — `src/lib/tsvad/roster-store.ts`:

```typescript
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
```

- [ ] **Step 5: Export** from `src/lib/tsvad/index.ts` — add:
```typescript
export { createLocalStorageRosterStore } from "./roster-store";
```
(`RosterMember`/`Roster`/`RosterStore` are exported via the existing `export * from "./types"`.)

- [ ] **Step 6: Run tests + tsc** — `pnpm test src/lib/tsvad/__tests__/roster-store.test.ts` → PASS; `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 7: Commit** — `git add src/lib/tsvad/types.ts src/lib/tsvad/roster-store.ts src/lib/tsvad/index.ts src/lib/tsvad/__tests__/roster-store.test.ts && git commit -m "feat(q1e): roster types + localStorage store with legacy-enrollment migration"`

---

### Task 2: Pipeline — score the window against the whole roster (principal drives the gate)

**Files:**
- Modify: `src/lib/tsvad/pipeline.ts`
- Create: `src/lib/tsvad/__tests__/pipeline-roster.test.ts`

**Interfaces:**
- Consumes: `Roster`, `RosterMember` (Task 1); `CandidateScore` from `./speaker-classifier`; existing `cosineSimilarity`, `gate`, `embedder`.
- Produces:
  - `ScoreEvent` gains an optional field: `scores?: import("./speaker-classifier").CandidateScore[]` (per-member cosines for this window; present only when enrolled).
  - New methods on `TargetSpeakerVad`: `setRoster(r: Roster): void` (replaces the single active target; sets the principal as the gate target) — and KEEP `setEnrollment(e: Enrollment | null): void` working (it sets a single principal-only roster, for back-compat with existing callers).
  - `isEnrolled()` returns true iff there is a principal member.

**Design (apply inside `createTargetSpeakerVad`):** replace the single `let enrollment: Enrollment | null` with roster state, keeping a `principal` reference for the gate:
```typescript
let members: RosterMember[] = [];
let principal: RosterMember | null = null;
function applyRoster(r: Roster) {
  members = r.members;
  principal = r.members.find((m) => m.id === r.principalId) ?? r.members[0] ?? null;
}
// init: applyRoster(opts.store?.load() ?? { principalId: null, members: [] })  // see NOTE on store type
```
> NOTE on `opts.store`: today the pipeline takes an `EnrollmentStore` and calls `load()/save()`. For this slice, change `createTargetSpeakerVad` to accept `opts.roster?: Roster` (the caller — `createBrowserTargetSpeakerVad` — loads it from the RosterStore and passes it in), and have `finishEnroll` call an `opts.onEnrolled?(e)` callback instead of `store.save`. This keeps the pure pipeline free of the store. `createBrowserTargetSpeakerVad` (in `index.ts`) wires the RosterStore: loads the roster, passes `roster`, and on `onEnrolled` adds/updates the principal member and saves. Define these option fields in `TargetSpeakerVadOptions`.

The enrolled branch of `maybeScore` becomes:
```typescript
} else if (principal) {
  const scores = members.map((m) => ({ id: m.id, cosine: cosineSimilarity(emb, m.enrollment.centroid) }));
  const raw = scores.find((s) => s.id === principal!.id)!.cosine; // principal drives the gate (unchanged)
  const now = performance.now();
  const dt = lastScoreTs ? now - lastScoreTs : hopMs;
  lastScoreTs = now;
  const state = gate.push(raw, dt);
  setGain(state.gain);
  emit({ raw, enrolled: true, level, scores, ...state });
}
```
Replace the pass-through guard `!enrollment && !enrolling` → `!principal && !enrolling`. `setEnrollment(e)` → `applyRoster(e ? { principalId: "principal", members: [{ id: "principal", name: e.name, enrollment: e }] } : { principalId: null, members: [] })`. `setRoster(r)` → `applyRoster(r)`. `isEnrolled()` → `!!principal`.

- [ ] **Step 1: Write the failing test** — `src/lib/tsvad/__tests__/pipeline-roster.test.ts`. Use a FAKE embedder so no ONNX is needed; drive scoring by feeding the public surface. Because `maybeScore` is internal, test through `setRoster` + a fake embedder + `onScore`, pushing audio via `start()` is heavy; INSTEAD test the **pure scoring helper** you extract:

  Extract a pure helper in `pipeline.ts` and test IT directly (keeps the test simple and the invariant explicit):
```typescript
// pipeline.ts — exported pure helper
export function scoreWindow(
  emb: Float32Array,
  members: { id: string; enrollment: { centroid: Float32Array } }[],
  principalId: string | null,
): { scores: { id: string; cosine: number }[]; raw: number | null } {
  if (!members.length) return { scores: [], raw: null };
  const scores = members.map((m) => ({ id: m.id, cosine: cosineSimilarity(emb, m.enrollment.centroid) }));
  const pid = principalId ?? members[0].id;
  return { scores, raw: scores.find((s) => s.id === pid)?.cosine ?? null };
}
```
  Test:
```typescript
import { describe, it, expect } from "vitest";
import { scoreWindow } from "../pipeline";

const m = (id: string, c: number[]) => ({ id, enrollment: { centroid: Float32Array.from(c) } });

describe("scoreWindow", () => {
  it("single principal member → raw is that member's cosine (back-compat)", () => {
    const { scores, raw } = scoreWindow(Float32Array.from([1, 0]), [m("p", [1, 0])], "p");
    expect(scores).toHaveLength(1);
    expect(raw).toBeCloseTo(1, 5);
  });
  it("multi-member → raw is the PRINCIPAL's cosine, scores carry all", () => {
    const emb = Float32Array.from([1, 0]);
    const { scores, raw } = scoreWindow(emb, [m("p", [1, 0]), m("r", [0, 1])], "p");
    expect(scores.map((s) => s.id)).toEqual(["p", "r"]);
    expect(raw).toBeCloseTo(1, 5);              // principal
    expect(scores.find((s) => s.id === "r")!.cosine).toBeCloseTo(0, 5);
  });
  it("no members → raw null, empty scores", () => {
    expect(scoreWindow(Float32Array.from([1]), [], null)).toEqual({ scores: [], raw: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test src/lib/tsvad/__tests__/pipeline-roster.test.ts` → FAIL (`scoreWindow` not exported).

- [ ] **Step 3: Implement** — add the `scoreWindow` helper (above), refactor `maybeScore`'s enrolled branch to call it (`const { scores, raw } = scoreWindow(emb, members, principal.id);` then gate on `raw`), add `ScoreEvent.scores?`, add `setRoster`/keep `setEnrollment`, add `roster`/`onEnrolled` options, and wire `createBrowserTargetSpeakerVad` (index.ts) to the RosterStore (load roster → pass; onEnrolled → upsert principal + save). Keep `applyRoster` for principal selection.

- [ ] **Step 4: Run tests** — `pnpm test src/lib/tsvad` → PASS. `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 5: Back-compat smoke** — `pnpm test` (full) → all green (existing VAD/grader tests unaffected; `ScoreEvent.scores` is additive/optional).

- [ ] **Step 6: Commit** — `git add src/lib/tsvad/pipeline.ts src/lib/tsvad/index.ts src/lib/tsvad/__tests__/pipeline-roster.test.ts && git commit -m "feat(q1e): pipeline scores the window vs the whole roster; principal drives the gate"`

---

### Task 3: VoiceAgent — attribute each turn to a name (classifier alongside the grader)

**Files:** Modify `src/components/VoiceAgent.tsx`. No unit harness → verify via tsc + build + on-device.

**Interfaces:**
- Consumes: `ScoreEvent.scores` (Task 2); `createSpeakerClassifier` + `CandidateScore` from `@/lib/tsvad`; the roster (for mapping member id → display name).
- Produces: each answered/heard turn carries an attributed display name; the existing grade chip is unchanged.

- [ ] **Step 1:** Import `createSpeakerClassifier, type SpeakerClassifier` and `createLocalStorageRosterStore` from `@/lib/tsvad`. Add refs: `const classifierRef = useRef<SpeakerClassifier | null>(null); if (!classifierRef.current) classifierRef.current = createSpeakerClassifier();` and `const rosterRef = useRef<import("@/lib/tsvad").Roster | null>(null);` plus `const lastSpeakerRef = useRef<string | null>(null)` (attributed display name for the turn).

- [ ] **Step 2:** Where the VAD score callback feeds the grader today (`vad.onScore((e) => graderRef.current!.addScore(e.raw, e.level))`), ALSO feed the classifier: `classifierRef.current!.addWindow(e.scores ?? [], e.level);`. Call `classifierRef.current!.begin()` in the same place the grader's `begin()` is called (`input_audio_buffer.speech_started`).

- [ ] **Step 3:** In the `input_audio_buffer.committed` handler, after the grader decision, compute attribution: `const who = classifierRef.current!.end(); const member = rosterRef.current?.members.find((m) => m.id === who.label); lastSpeakerRef.current = who.label === "unknown" ? "unknown" : (member?.name ?? member?.id ?? null);` Attach `lastSpeakerRef.current` to the turn the same way `lastRespondGradeRef` is attached (add a `speaker?: string` field to the `Turn` interface; set it in the transcription-completed backfill, then clear `lastSpeakerRef`).

- [ ] **Step 4:** Load + hold the roster: in `startSession` (where `createBrowserTargetSpeakerVad` is created), `rosterRef.current = createLocalStorageRosterStore().load();`. (The VAD itself loads the roster internally; this ref is just for id→name mapping in the UI.)

- [ ] **Step 5:** Render the attributed name on user turns next to the grade chip (in the user-bubble timestamp row added for the grade chip): show `turn.speaker` when present, e.g. a small `{turn.speaker}` label dimmed; "unknown" renders in a muted color. Keep it subtle (same scale as the grade chip).

- [ ] **Step 6: Verify** — `pnpm exec tsc --noEmit && pnpm build` clean; `pnpm test` still green. On-device check deferred to the final list.

- [ ] **Step 7: Commit** — `git add src/components/VoiceAgent.tsx && git commit -m "feat(q1e): attribute each turn to a roster name (classifier alongside the grader)"`

---

### Task 4: UI — "Add another voice" + roster view

**Files:** Modify `src/components/VoiceAgent.tsx` (reuse `VoiceEnrollment.tsx` as-is — its name step already exists).

**Interfaces:**
- Consumes: `createLocalStorageRosterStore`, the VAD `enroll()` (captures a centroid), the existing `VoiceEnrollment` (returns an `Enrollment` with optional `name`).
- Produces: an "add another voice" affordance that enrolls a NEW member (does not overwrite the principal); a small roster list; persists via the RosterStore.

- [ ] **Step 1:** Distinguish "enroll principal" (today's button, when no principal) from "add another voice" (when a principal exists). The enroll modal already mutes Ed (`setEnrolling`). On the enroll `onComplete(e)`: if there is no principal yet → this IS the principal (id `"principal"`); else → a new member with a generated id (`member_${Date.now()}`), name from `e.name`. Build the updated `Roster` (append/replace member, set `principalId` if first), `createLocalStorageRosterStore().save(roster)`, update `rosterRef.current`, and call `vadRef.current?.setRoster(roster)` so live scoring picks it up immediately. `pushEvent` "Added voice: <name>".

- [ ] **Step 2:** A minimal roster view: list members (name ?? id, principal tagged "you"), each with a remove button → rebuild roster without it, save, `setRoster`. Place it near the existing enroll button (small, unobtrusive).

- [ ] **Step 3:** Label the enroll button by context: "enroll" when no principal, "add another voice" when a principal exists.

- [ ] **Step 4: Verify** — `pnpm exec tsc --noEmit && pnpm build` clean; `pnpm test` green.

- [ ] **Step 5: Commit** — `git add src/components/VoiceAgent.tsx && git commit -m "feat(q1e): add-another-voice + roster view (manual multi-speaker enrollment)"`

---

## Final verification

- [ ] `pnpm test` green; `pnpm exec tsc --noEmit && pnpm build` clean.
- [ ] **Back-compat (critical):** with only the principal enrolled, respond/suppress behaves exactly as before (the `scoreWindow` test pins `raw`; confirm on-device that grading still gates to you).
- [ ] **On-device:** enroll yourself (principal) → "add another voice" for a second person → that person speaks → their turn is **labeled with their name** and Ed does **not** act on it (suppressed/heard); you speak → responded + your name; a stranger → "unknown". Remove a member → it stops being attributed.
- [ ] Update `PROJECT_STATUS.md` + journal; `bd close edmini-q1e` (or keep open if only the thin slice landed — note the gate-swap follow-on) + `needs-verification`.

## Out of scope (this slice)

- **Changing the gate to the classifier** (multi-principal, or principal-via-classifier): the gate stays the existing principal `UtteranceGrader`. Identify-only.
- **Voice-triggered enrollment** (`enroll_speaker` tool, `edmini-6kl`) — a later 2nd entry point to the same roster.
- **Per-speaker `from` in the ledger / search_history** — wiring attribution into ledger events is a follow-on.
- **Retroactive enrollment / rolling buffer** (`6kl` retro) and **passive adaptation**.
