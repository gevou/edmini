# Grade-and-Suppress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make edmini respond only to its enrolled user — TS-VAD grades each utterance in parallel; OpenAI gets the raw mic; at turn-end edmini either responds or suppresses (deletes the item + logs `heard`).

**Architecture:** The validated TS-VAD engine (`edmini-7vr`) runs for its `onScore` stream only (raw mic still goes to OpenAI — no inline gate, no clipping). A pure `utterance-grader` buffers per-window scores between `speech_started`/`speech_stopped` and reduces them to `respond | suppress`. OpenAI runs with `create_response:false`; on `input_audio_buffer.committed` edmini fires `response.create` (respond) or `conversation.item.delete` + a `heard` ledger event (suppress).

**Tech Stack:** TypeScript, Next.js 15 (App Router), React 19, OpenAI Realtime API over WebRTC, Supabase ledger, `onnxruntime-web` (CAM++), vitest, pnpm.

**Spec:** [docs/superpowers/specs/2026-06-21-grade-and-suppress-design.md](../specs/2026-06-21-grade-and-suppress-design.md) · **Bead:** `edmini-5y7` (depends on `edmini-7vr`)

## Global Constraints

- **Opt-in, default OFF.** A localStorage flag `ed_grading_enabled` ("1"/absent) enables grading. Off → today's behavior exactly (auto-response, no scorer). Verbatim from spec.
- **Pass-through until enrolled.** Flag on but no enrollment → every utterance grades `respond`.
- **Fail OPEN.** Any scorer/model error → grade `respond` for every utterance + log the error. Never lock the user out.
- **Realtime API (verified 2026-06-21):** `session.audio.input.turn_detection.create_response:false` suppresses auto-response (keep `interrupt_response:true`). Do **not** send `input_audio_buffer.commit`. Canonical user `item_id` is on `input_audio_buffer.committed`. Tag client `response.create` with `metadata`. `gpt-realtime` only (not `-whisper`).
- SQL columns snake_case; TS/JSON keys camelCase. Test runner: vitest (`pnpm test`). `pnpm exec tsc --noEmit`, `pnpm build`. Commit after each task. If `tsc` errors on stale `.next/types`, `rm -rf .next` first.

## File structure

- **Create** `src/lib/voice/utterance-grader.ts` — pure reducer: buffer per-window scores → `respond | suppress`. + `src/lib/voice/__tests__/utterance-grader.test.ts`.
- **Create** `src/app/api/heard/route.ts` — service-role append of a `heard` ledger event (mirrors `voice-output`). + test.
- **Modify** `src/app/api/session/route.ts` — accept `{ grading?: boolean }`; when true, set `create_response:false`.
- **Modify** `src/components/VoiceAgent.tsx` — scorer lifecycle; grader wiring; `committed` → respond/suppress; enrollment UI + grading toggle; teardown.

## Task 0: Land the TS-VAD engine (`edmini-7vr`) on `main`

The grade-and-suppress code imports `@/lib/tsvad`, which lives on PR #5 (branch `claude/intelligent-meitner-xfh3of`, already rebased onto `main`, 139 tests green, validated). Merge it so this plan builds on `main`.

**This is a decision gate — confirm with the user before merging (it lands `onnxruntime-web` + the `/tsvad-lab` page in prod; both are isolated/lazy, low risk).**

- [ ] **Step 1: Confirm + merge PR #5**

```bash
gh pr checks 5      # ensure green
git checkout main && git pull
git merge --no-ff claude/intelligent-meitner-xfh3of -m "merge: target-speaker VAD engine (edmini-7vr / PR #5)"
pnpm install        # onnxruntime-web
pnpm test           # expect 139 green
git push
```

- [ ] **Step 2: Close the engine bead**

```bash
bd close edmini-7vr --reason "TS-VAD engine merged to main; validated (offline margin 0.69, live English 0.4-0.6+). Consumed by grade-and-suppress (edmini-5y7)."
```

> If the user prefers NOT to merge yet, branch this plan's worktree off `claude/intelligent-meitner-xfh3of` instead of `main`. The rest of the tasks are identical.

---

## Task 1: `utterance-grader.ts` — the pure decision reducer

**Files:**
- Create: `src/lib/voice/utterance-grader.ts`
- Test: `src/lib/voice/__tests__/utterance-grader.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `createUtteranceGrader(policy?: GraderPolicy): UtteranceGrader`; types `GradeDecision = { decision: "respond" | "suppress"; confidence: number; voicedWindows: number }`, `UtteranceGrader = { begin(): void; addScore(raw: number | null, level: number): void; end(): GradeDecision }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createUtteranceGrader } from "../utterance-grader";

// helper: feed a sequence of [raw, level] windows through one utterance
function grade(scores: Array<[number | null, number]>, policy?: Parameters<typeof createUtteranceGrader>[0]) {
  const g = createUtteranceGrader(policy);
  g.begin();
  for (const [raw, level] of scores) g.addScore(raw, level);
  return g.end();
}

describe("utterance-grader", () => {
  it("responds when mean cosine over voiced windows clears the threshold", () => {
    const r = grade([[0.5, 0.2], [0.55, 0.2], [0.6, 0.2], [0.5, 0.2], [0.52, 0.2]]);
    expect(r.decision).toBe("respond");
    expect(r.confidence).toBeGreaterThan(0.45);
    expect(r.voicedWindows).toBe(5);
  });

  it("suppresses when the mean is below the threshold (a different speaker)", () => {
    const r = grade([[0.05, 0.2], [-0.02, 0.2], [0.1, 0.2], [0.0, 0.2], [0.08, 0.2]]);
    expect(r.decision).toBe("suppress");
  });

  it("ignores silence windows (below the voiced floor) in the mean", () => {
    // 5 loud low-score windows + many silent high-score windows; silence must not sway it.
    const r = grade([
      [0.05, 0.2], [0.05, 0.2], [0.05, 0.2], [0.05, 0.2], [0.05, 0.2],
      [0.9, 0.001], [0.9, 0.001], [0.9, 0.001],
    ]);
    expect(r.decision).toBe("suppress");
    expect(r.voicedWindows).toBe(5);
  });

  it("allow-if-uncertain: too few voiced windows → respond (don't refuse a quick 'stop')", () => {
    const r = grade([[0.1, 0.2], [0.05, 0.2]]); // 2 windows, below minVoicedWindows
    expect(r.decision).toBe("respond");
  });

  it("pass-through: not enrolled (all raw null) → respond", () => {
    const r = grade([[null, 0.2], [null, 0.2], [null, 0.2], [null, 0.2], [null, 0.2]]);
    expect(r.decision).toBe("respond");
  });

  it("empty / all-silence utterance → respond (nothing to judge)", () => {
    expect(grade([]).decision).toBe("respond");
    expect(grade([[0.05, 0.0], [0.05, 0.0]]).decision).toBe("respond");
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `pnpm test src/lib/voice/__tests__/utterance-grader.test.ts`
Expected: FAIL ("Cannot find module '../utterance-grader'").

- [ ] **Step 3: Implement**

```ts
/**
 * Utterance grader (edmini-5y7) — pure reducer over the TS-VAD per-window scores for one user turn.
 * Decides whether edmini should respond. Speaker-ID is text-independent and needs ~1s of voiced audio
 * to be confident, so we grade the COMPLETED utterance (all windows in hand) rather than gating live.
 *
 * Policy: mean cosine over VOICED windows (silence carries no speaker evidence). Bias to `respond` when
 * uncertain — a missed bystander is a minor blip, but refusing the user's quick "stop" is a bad failure.
 * Not enrolled (raw === null) → always respond (pass-through). Pure: no React, no I/O.
 */
export interface GraderPolicy {
  /** Respond when mean voiced cosine ≥ this. Below the live gate's 0.45 since we average a full, clean
   *  utterance rather than a cold-start ramp. Tune from on-device data. */
  respondThreshold?: number;
  /** Fewer voiced windows than this → too short to grade → allow-if-uncertain (respond). */
  minVoicedWindows?: number;
  /** RMS level below which a window is silence (no speaker evidence) and excluded from the mean. */
  voicedLevelFloor?: number;
}

export interface GradeDecision {
  decision: "respond" | "suppress";
  /** Mean cosine over voiced windows (0 when none). */
  confidence: number;
  voicedWindows: number;
}

export interface UtteranceGrader {
  /** Reset state for a new utterance. */
  begin(): void;
  /** Feed one window's raw cosine (null when not enrolled) + RMS level. */
  addScore(raw: number | null, level: number): void;
  /** Reduce the buffered windows to a decision. */
  end(): GradeDecision;
}

export function createUtteranceGrader(policy: GraderPolicy = {}): UtteranceGrader {
  const respondThreshold = policy.respondThreshold ?? 0.35;
  const minVoicedWindows = policy.minVoicedWindows ?? 4;
  const voicedLevelFloor = policy.voicedLevelFloor ?? 0.015;

  let sum = 0;
  let voiced = 0;
  let sawEnrolledScore = false;

  return {
    begin() {
      sum = 0;
      voiced = 0;
      sawEnrolledScore = false;
    },
    addScore(raw, level) {
      if (raw === null) return; // not enrolled → no evidence
      sawEnrolledScore = true;
      if (level < voicedLevelFloor) return; // silence → no speaker evidence
      sum += raw;
      voiced += 1;
    },
    end(): GradeDecision {
      const confidence = voiced > 0 ? sum / voiced : 0;
      // Pass-through (never enrolled) or too-short/empty → respond.
      if (!sawEnrolledScore || voiced < minVoicedWindows) {
        return { decision: "respond", confidence, voicedWindows: voiced };
      }
      return {
        decision: confidence >= respondThreshold ? "respond" : "suppress",
        confidence,
        voicedWindows: voiced,
      };
    },
  };
}
```

- [ ] **Step 4: Run → pass**

Run: `pnpm test src/lib/voice/__tests__/utterance-grader.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/utterance-grader.ts src/lib/voice/__tests__/utterance-grader.test.ts
git commit -m "feat(5y7): utterance-grader — pure respond/suppress reducer [edmini-5y7]"
```

---

## Task 2: `/api/heard` route — log a suppressed utterance

**Files:**
- Create: `src/app/api/heard/route.ts`
- Test: `src/app/api/heard/__tests__/route.test.ts`

**Interfaces:**
- Produces: `POST /api/heard` body `{ text?: string; confidence?: number; threadId?: string | null }` → appends `{ source:"user", kind:"heard", threadId, payload:{ text, confidence } }`; returns `{ ok: true }`.

- [ ] **Step 1: Write the failing test** (mirror `src/app/api/voice-output/__tests__/route.test.ts`'s mocking style — read it first)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const append = vi.fn();
vi.mock("@/lib/ledger-supabase", () => ({ ledgerFromEnv: () => ({ append }) }));

import { POST } from "../route";

function req(body: unknown) {
  return new Request("http://test/api/heard", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/heard", () => {
  beforeEach(() => append.mockReset().mockResolvedValue({}));

  it("appends a heard event (source user, kind heard) with confidence + text", async () => {
    const res = await POST(req({ text: "is dinner ready", confidence: 0.12, threadId: "thr_1" }));
    expect(res.status).toBe(200);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      source: "user", kind: "heard", threadId: "thr_1",
      payload: expect.objectContaining({ text: "is dinner ready", confidence: 0.12 }),
    }));
  });

  it("400 on invalid JSON", async () => {
    const bad = new Request("http://test/api/heard", { method: "POST", body: "{not json" });
    expect((await POST(bad)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `pnpm test src/app/api/heard/__tests__/route.test.ts`
Expected: FAIL (no `../route`).

- [ ] **Step 3: Implement**

```ts
/**
 * Heard-event tap (edmini-5y7) — records an utterance edmini HEARD but suppressed (not the enrolled
 * user). The conversational-presence "capture" rail: ambient input becomes a durable ledger event so
 * decide-later promotion is a re-interpretation over the ledger, not lost state. Service-role write
 * (browser holds only the anon key); mirrors /api/voice-output.
 */
import { ledgerFromEnv } from "@/lib/ledger-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: { text?: string; confidence?: number; threadId?: string | null };
  try { body = (await request.json()) as typeof body; }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  try {
    const ledger = ledgerFromEnv({ serviceRole: true });
    await ledger.append({
      runId: null,
      threadId: body.threadId ?? null,
      source: "user",
      kind: "heard",
      payload: { text: body.text ?? null, confidence: body.confidence ?? null },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run → pass**

Run: `pnpm test src/app/api/heard/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/heard/route.ts src/app/api/heard/__tests__/route.test.ts
git commit -m "feat(5y7): /api/heard — log suppressed (ambient) utterances [edmini-5y7]"
```

---

## Task 3: Session route — grading mode sets `create_response:false`

**Files:**
- Modify: `src/app/api/session/route.ts`
- Test: `src/app/api/session/__tests__/route.test.ts` (create if absent; otherwise extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `POST /api/session` honors `{ grading?: boolean }` in the body — when `true`, the created session's `audio.input.turn_detection` includes `create_response:false` (and keeps `interrupt_response` default).

- [ ] **Step 1: Read the route** — it builds `body: JSON.stringify({ ... session: { audio: { input: { turn_detection: { type:"server_vad", threshold, prefix_padding_ms, silence_duration_ms } } } } })` and POSTs to `https://api.openai.com/v1/realtime/client_secrets`. Note the current handler reads no request body.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
import { POST } from "../route";

function bodyOf(call: number) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

describe("POST /api/session grading flag", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ value: "ek" }) });
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("omits create_response by default (auto-response on)", async () => {
    await POST(new Request("http://t/api/session", { method: "POST", body: JSON.stringify({}) }));
    const td = bodyOf(0).session.audio.input.turn_detection;
    expect(td.create_response).toBeUndefined();
  });

  it("sets create_response:false when grading is requested", async () => {
    await POST(new Request("http://t/api/session", { method: "POST", body: JSON.stringify({ grading: true }) }));
    const td = bodyOf(0).session.audio.input.turn_detection;
    expect(td.create_response).toBe(false);
  });
});
```

- [ ] **Step 3: Run → fail**

Run: `pnpm test src/app/api/session/__tests__/route.test.ts`
Expected: FAIL (default test may pass; the grading test fails — `create_response` not set).

- [ ] **Step 4: Implement** — in `src/app/api/session/route.ts`:

Parse the (optional) body near the top of `POST`:
```ts
let grading = false;
try { grading = Boolean(((await request.clone().json()) as { grading?: boolean }).grading); } catch { /* no body */ }
```
Then build `turn_detection` so the field is conditional:
```ts
turn_detection: {
  type: "server_vad",
  threshold: 0.5,
  prefix_padding_ms: 300,
  silence_duration_ms: 800,
  ...(grading ? { create_response: false } : {}),
},
```
(Leave everything else unchanged; `interrupt_response` stays default. `request.clone()` avoids consuming the body the existing key-header logic may also read.)

- [ ] **Step 5: Run → pass**

Run: `pnpm test src/app/api/session/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/session/route.ts src/app/api/session/__tests__/route.test.ts
git commit -m "feat(5y7): session route — grading mode disables auto-response [edmini-5y7]"
```

---

## Task 4: VoiceAgent — scorer lifecycle (raw mic preserved)

> Tasks 4–6 modify `src/components/VoiceAgent.tsx`, a large client component with WebRTC + the OpenAI data channel. It has no unit tests in this repo; verify each with `pnpm exec tsc --noEmit` + `pnpm build`, and the live checklist at the end. Make ADDITIVE changes — never remove existing behavior.

**Files:** Modify `src/components/VoiceAgent.tsx`

**Interfaces:**
- Consumes: `createBrowserTargetSpeakerVad`, `type TargetSpeakerVad`, `type ScoreEvent` from `@/lib/tsvad`; `createUtteranceGrader`, `type UtteranceGrader` from `@/lib/voice/utterance-grader`.
- Produces: `gradingEnabledRef`, `vadRef`, `graderRef`, `pendingCommitRef`, `recordHeard()` used by Task 5.

- [ ] **Step 1: Imports + refs + flag**

Add imports:
```ts
import { createBrowserTargetSpeakerVad, type TargetSpeakerVad } from "@/lib/tsvad";
import { createUtteranceGrader, type UtteranceGrader } from "@/lib/voice/utterance-grader";
```
Add refs near the other `useRef`s:
```ts
const vadRef = useRef<TargetSpeakerVad | null>(null);
const graderRef = useRef<UtteranceGrader | null>(null);
if (!graderRef.current) graderRef.current = createUtteranceGrader();
// Grading mode: opt-in via localStorage "ed_grading_enabled" = "1". Read once at session start.
const gradingEnabledRef = useRef(false);
```
Add a constant near `STORAGE_KEY`:
```ts
const GRADING_KEY = "ed_grading_enabled";
```

- [ ] **Step 2: Pass the flag to /api/session + start the scorer on the raw mic**

In `startSession`, set the flag from localStorage right after `setStatus("connecting")`:
```ts
gradingEnabledRef.current = typeof localStorage !== "undefined" && localStorage.getItem(GRADING_KEY) === "1";
```
Change the `/api/session` POST to send the flag (it currently sends only headers):
```ts
const sessionRes = await fetch("/api/session", {
  method: "POST", headers,
  body: JSON.stringify({ grading: gradingEnabledRef.current }),
});
```
After `const stream = await navigator.mediaDevices.getUserMedia({ audio: {...} });` and BEFORE `stream.getTracks().forEach((t) => pc.addTrack(t, stream));` (raw stream still feeds the peer connection — unchanged), start the scorer when grading is on. Fail OPEN:
```ts
if (gradingEnabledRef.current) {
  try {
    const vad = await createBrowserTargetSpeakerVad({ modelUrl: "/models/campplus.onnx" });
    await vad.start(stream);                       // taps the mic; does NOT consume it
    vad.onScore((e) => graderRef.current!.addScore(e.raw, e.level));
    vadRef.current = vad;
    pushEvent({ kind: "info", label: "Speaker grading active", detail: vad.isEnrolled() ? "enrolled" : "pass-through (enroll to gate)" });
  } catch (err) {
    vadRef.current = null;                          // fail open — grader sees no scores → always respond
    pushEvent({ kind: "error", label: "Speaker grading unavailable (responding to all)", detail: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 3: Teardown in `stopSession`**

Add near the other resets in `stopSession`:
```ts
void vadRef.current?.stop();
vadRef.current = null;
graderRef.current = createUtteranceGrader();
```

- [ ] **Step 4: Verify**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: clean (the grading branch only runs when the flag is set; default path unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/VoiceAgent.tsx
git commit -m "feat(5y7): VoiceAgent — start/stop the parallel speaker scorer (raw mic preserved) [edmini-5y7]"
```

---

## Task 5: VoiceAgent — grade at turn-end, respond or suppress

**Files:** Modify `src/components/VoiceAgent.tsx`

**Interfaces:**
- Consumes: `gradingEnabledRef`, `vadRef`, `graderRef`, `fireResponse`, `voiceThreadIdRef` (from `shd`), the data-channel handler.
- Produces: the `respond`/`suppress` behavior on `input_audio_buffer.committed`.

- [ ] **Step 1: Add a `heard` logger + a pending-suppression tracker**

Near `logVoiceOutput`, add:
```ts
const recordHeard = useCallback((text: string | null, confidence: number) => {
  void fetch("/api/heard", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, confidence, threadId: voiceThreadIdRef.current }),
  }).catch(() => {});
}, []);
```
Add a ref near the others to remember a suppressed turn's id until its transcript arrives:
```ts
const suppressedTurnRef = useRef<{ itemId: string; confidence: number } | null>(null);
```

- [ ] **Step 2: Mark utterance boundaries on the grader**

In `handleDataChannelMessage`, in the existing `input_audio_buffer.speech_started` branch add:
```ts
if (gradingEnabledRef.current) graderRef.current!.begin();
```
(The `onScore` subscription from Task 4 already feeds `addScore` between begin and end.)

- [ ] **Step 3: Decide on `committed`**

Add a new branch in `handleDataChannelMessage` (server-VAD emits `input_audio_buffer.committed` with the user item id):
```ts
if (type === "input_audio_buffer.committed") {
  if (!gradingEnabledRef.current) return;          // auto-response mode: nothing to do
  const itemId = serverEvent.item_id as string | undefined;
  const { decision, confidence } = graderRef.current!.end();
  if (decision === "respond") {
    pushEvent({ kind: "info", label: "Grade: respond", detail: `conf ${confidence.toFixed(2)}` });
    // user item already committed by the server → fire a bare response.create (tag it ours)
    fireResponse(() => {}, { metadata: { src: "client" } });
  } else if (itemId) {
    pushEvent({ kind: "info", label: "Grade: suppress (not you)", detail: `conf ${confidence.toFixed(2)}` });
    dcRef.current?.send(JSON.stringify({ type: "conversation.item.delete", item_id: itemId }));
    suppressedTurnRef.current = { itemId, confidence }; // log the text when its transcript lands
  }
  return;
}
```

- [ ] **Step 4: Extend `fireResponse` to carry an optional response payload**

Change `fireResponse`'s signature + body so respond can attach `metadata` (default unchanged for existing callers):
```ts
const fireResponse = useCallback((sendItems: () => void, response?: Record<string, unknown>) => {
  const dc = dcRef.current;
  if (!dc || dc.readyState !== "open") return;
  responseActiveRef.current = true;
  sendItems();
  dc.send(JSON.stringify(response ? { type: "response.create", response } : { type: "response.create" }));
}, []);
```
(Existing calls `fireResponse(sendOutput)` / `fireResponse(next)` keep working — `response` is optional.)

- [ ] **Step 5: Log the suppressed transcript when it arrives**

In the existing `conversation.item.input_audio_transcription.completed` branch, at the top, drain a pending suppression so a bystander's words are recorded as `heard` and NOT shown as a user turn:
```ts
if (suppressedTurnRef.current) {
  const { confidence } = suppressedTurnRef.current;
  suppressedTurnRef.current = null;
  const t = (serverEvent.transcript as string | undefined)?.trim() ?? null;
  recordHeard(t, confidence);
  return; // do not render a turn / postTurnToTopic for a suppressed utterance
}
```

- [ ] **Step 6: Verify**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/VoiceAgent.tsx
git commit -m "feat(5y7): VoiceAgent — grade at committed; respond or suppress+heard [edmini-5y7]"
```

---

## Task 6: VoiceAgent — enrollment + a grading toggle

**Files:** Modify `src/components/VoiceAgent.tsx`

**Interfaces:**
- Consumes: `vadRef`, `VoiceEnrollment` from `@/lib/tsvad/ui/VoiceEnrollment`, `gradingEnabledRef`.
- Produces: a UI path to enroll + toggle grading.

- [ ] **Step 1: Import the enrollment UI + add toggle state**

```ts
import { VoiceEnrollment } from "@/lib/tsvad/ui/VoiceEnrollment";
```
Add component state near the others:
```ts
const [showEnroll, setShowEnroll] = useState(false);
const [gradingOn, setGradingOn] = useState(false);
```
Initialize `gradingOn` from localStorage in the existing key-load `useEffect`:
```ts
setGradingOn(localStorage.getItem(GRADING_KEY) === "1");
```

- [ ] **Step 2: A small control (header area) to toggle grading + enroll**

Near the header `key` button, add (only meaningful while connected for enroll):
```tsx
<button
  onClick={() => {
    const next = !gradingOn;
    setGradingOn(next);
    localStorage.setItem(GRADING_KEY, next ? "1" : "0");
  }}
  title="Only respond to my voice (takes effect next session)"
  className="mt-1 text-white/20 text-xs tracking-widest uppercase hover:text-white/40 transition-colors"
  style={{ minHeight: 36, padding: "0 4px" }}
>
  {gradingOn ? "grading on" : "grading off"}
</button>
{gradingOn && vadRef.current && status !== "idle" && (
  <button onClick={() => setShowEnroll(true)} className="mt-1 text-white/20 text-xs tracking-widest uppercase hover:text-white/40">
    enroll
  </button>
)}
```

- [ ] **Step 3: Render the enrollment overlay when requested**

Where the transcript renders, conditionally mount:
```tsx
{showEnroll && vadRef.current && (
  <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.6)", zIndex: 50, padding: 16 }}>
    <VoiceEnrollment
      vad={vadRef.current}
      onComplete={() => { setShowEnroll(false); pushEvent({ kind: "info", label: "Voice enrolled — grading now gates to you" }); }}
      onCancel={() => setShowEnroll(false)}
    />
  </div>
)}
```

- [ ] **Step 4: Verify**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/VoiceAgent.tsx
git commit -m "feat(5y7): VoiceAgent — grading toggle + voice enrollment UI [edmini-5y7]"
```

---

## Final verification (whole feature)

- [ ] **Unit:** `pnpm test` — all green (grader 6, heard route 2, session route 2, + existing).
- [ ] **Typecheck/build:** `pnpm exec tsc --noEmit && pnpm build` — clean.
- [ ] **Deploy** (app push to `main` auto-deploys Vercel; the model `public/models/campplus.onnx` must be served — for prod, host it; for the device test, the worktree dev server already serves it).
- [ ] **Live (device, headphones not required now — that's the point):**
  - Grading OFF → behavior is exactly as today (auto-response). ✓
  - Grading ON, not enrolled → Ed still responds to everyone (pass-through); UI prompts to enroll.
  - Enroll, then: **you speak → Ed responds**; **a bystander / Ed's echo on speaker → Ed stays silent**, a `heard` event lands in the ledger, no user turn rendered; **a quick "stop" → Ed responds** (short-utterance fallback).
  - Kill the model URL (simulate failure) → Ed responds to all + an error chip (fail-open). 
  - Confirm in Supabase: suppressed turns appear as `kind:"heard"` events; answered turns drive normal `voice_output`.
- [ ] **Close-out:** `bd close edmini-5y7 --reason "…"` + `bd label add edmini-5y7 needs-verification`.

## Notes for the executor

- **Worktree:** use a fresh worktree off `main` (after Task 0 merges the engine). Copy `.env.local` in (gitignored) for build. Put `public/models/campplus.onnx` in place (download per `edmini-7vr`: HF `csukuangfj/speaker-embedding-models/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx`) — gitignored, not committed.
- **Don't** wire `getProcessedStream()` — the raw mic is what reaches OpenAI. The scorer only feeds `onScore`.
- The deferred **speculative pre-authorization** alternative (spec) is explicitly NOT built here.
