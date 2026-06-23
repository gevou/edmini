/**
 * Non-speech / whisper-hallucination rejection for finalized user transcripts (edmini-put). Pure.
 *
 * Observed live: a macOS volume BEEP leaked into the mic, whisper transcribed it as "Bye-bye", and that
 * phantom user turn triggered a real Ed response (and a fake user_utterance in the ledger). For an
 * ENROLLED user the speaker grader already suppresses this (the beep scores far below the centroid). This
 * module is the fallback for the NOT-enrolled (pass-through) case, where there's no speaker evidence.
 *
 * Signals (verified against the OpenAI Realtime API, not assumed): the GA Realtime transcription event
 * exposes per-token `logprobs` (enabled via session `include: ["item.input_audio_transcription.logprobs"]`)
 * — NOT the batch-Whisper `no_speech_prob`/`avg_logprob`. So we combine (a) empty transcripts, (b) a small
 * set of classic non-speech artifacts whisper emits on silence/noise, and (c) a mean-logprob confidence
 * floor. It degrades gracefully when logprobs are absent (empty + always-drop artifacts still caught).
 *
 * Limitation: whisper hallucinations are sometimes deceptively high-confidence, so this REDUCES — does not
 * eliminate — phantom turns for the not-enrolled case. Enrolling (speaker grading) is the robust fix.
 * Thresholds and phrase lists are heuristic and meant to be tuned on device (relates: edmini-ce9).
 */

export interface TranscriptLogprob {
  token: string;
  logprob: number;
  bytes?: number[];
}

export interface NonSpeechPolicy {
  /** Mean token logprob at/below which an ambiguous stock phrase is treated as a hallucination. */
  minMeanLogprob?: number;
  /** Mean logprob at/below which ANY transcript is dropped as garbage, regardless of its text. */
  hardFloorLogprob?: number;
  /** Phrases that are non-speech artifacts as a WHOLE utterance — dropped regardless of confidence. */
  alwaysDropPhrases?: string[];
  /** Phrases that might be genuine — dropped only when logprobs confirm low confidence. */
  lowConfidencePhrases?: string[];
}

// Classic whisper non-speech hallucinations (YouTube-caption training residue) that, as the entire
// utterance, are essentially never a real command to a coordination agent.
const DEFAULT_ALWAYS_DROP = [
  "thanks for watching",
  "thank you for watching",
  "thanks for watching everyone",
  "please subscribe",
  "subscribe to my channel",
  "like and subscribe",
  "you're watching",
  "bye-bye",
  "♪",
  "music",
  "[music]",
  "(music)",
  "[silence]",
  "[ silence ]",
  "(silence)",
];

// Short tokens that DO occur as genuine speech, so only drop them when logprobs say low-confidence.
const DEFAULT_LOW_CONF = ["thank you", "thanks", "bye", "okay", "ok", "you", "so", "uh", "um", "hmm"];

export const DEFAULT_NON_SPEECH_POLICY: Required<NonSpeechPolicy> = {
  // whisper's confident speech tokens sit well above -0.7; a stock phrase below it is suspect.
  minMeanLogprob: -0.7,
  // Below this the model was essentially guessing — garbage regardless of what it "said".
  hardFloorLogprob: -2.0,
  alwaysDropPhrases: DEFAULT_ALWAYS_DROP,
  lowConfidencePhrases: DEFAULT_LOW_CONF,
};

/** Mean of the per-token logprobs, or null when none are available (logprobs not requested/returned). */
export function meanLogprob(logprobs?: TranscriptLogprob[] | null): number | null {
  if (!logprobs || logprobs.length === 0) return null;
  let sum = 0;
  for (const l of logprobs) sum += l.logprob;
  return sum / logprobs.length;
}

/** Normalize for phrase matching: trim, lowercase, strip surrounding punctuation, collapse whitespace. */
export function normalizeTranscript(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/^[\s.,!?…"'’\-–—]+|[\s.,!?…"'’\-–—]+$/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Decide whether a finalized transcript is likely non-speech (silence/beep/noise → whisper hallucination)
 * rather than a real user utterance. See module header for the signals and their limits.
 */
export function isLikelyNonSpeech(
  input: { transcript: string; logprobs?: TranscriptLogprob[] | null },
  policy: NonSpeechPolicy = {},
): boolean {
  const p = { ...DEFAULT_NON_SPEECH_POLICY, ...policy };
  const norm = normalizeTranscript(input.transcript);
  if (norm === "") return true;

  const m = meanLogprob(input.logprobs);
  if (m !== null && m <= p.hardFloorLogprob) return true;
  if (p.alwaysDropPhrases.includes(norm)) return true;
  if (p.lowConfidencePhrases.includes(norm) && m !== null && m <= p.minMeanLogprob) return true;
  return false;
}
