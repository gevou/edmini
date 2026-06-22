/**
 * Deterministic ledger injector for session-memory (edmini-iee) live checks.
 *
 *   pnpm ledger:seed dispatch <label> [instruction]      -> mints a run, writes task_dispatch, prints runId
 *   pnpm ledger:seed reply <runId> [kind] [text]         -> writes a harness event for a run (default run_done)
 *   pnpm ledger:seed convo <userText> <edText>           -> writes a user_utterance + voice_output pair
 *   pnpm ledger:seed tail [n]                             -> prints the last n ledger events (default 12)
 *
 * Why this exists: the only thing the (b)/(c) checks really test is an async **harness** event (source
 * "harness") landing in the ledger at a controlled moment — normally produced by the Fly bus worker off a
 * real Hermes run, which is slow and non-deterministic. This writes those events directly via the
 * service-role key, so you control the timing and don't wait on Hermes. Input (the spoken commands) can
 * stay voice/TTS; the run lifecycle becomes scriptable. See docs/testing/session-memory-live-checks.md.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local).
 *
 * harness render fields (must match NARRATE in VoiceAgent.tsx):
 *   run_done -> payload.summary | run_output -> payload.text | run_blocked -> payload.question | run_failed -> payload.error
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" }); // override with project-local secrets if present
import { ledgerFromEnv } from "../src/lib/ledger-supabase";
import { mintRunId, mintThreadId } from "../src/lib/ids";

const FIELD_FOR_KIND: Record<string, string> = {
  run_done: "summary",
  run_output: "text",
  run_blocked: "question",
  run_failed: "error",
};

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const ledger = ledgerFromEnv({ serviceRole: true });

  switch (cmd) {
    case "dispatch": {
      const label = args[0];
      if (!label) throw new Error("usage: dispatch <label> [instruction]");
      const instruction = args.slice(1).join(" ") || `seeded task '${label}'`;
      const runId = mintRunId();
      const threadId = mintThreadId();
      const e = await ledger.append({
        runId, threadId, source: "edmini", kind: "task_dispatch",
        payload: { instruction, label, prevRunId: null, apiIdentifier: null, seeded: true },
      });
      console.log(`✓ task_dispatch seq=${e.seq} label='${label}'`);
      console.log(`runId=${runId}`); // copy this for `reply`
      break;
    }
    case "reply": {
      const runId = args[0];
      const kind = args[1] ?? "run_done";
      const text = args.slice(2).join(" ") || "(seeded harness reply)";
      if (!runId) throw new Error("usage: reply <runId> [run_done|run_output|run_blocked|run_failed] [text]");
      const field = FIELD_FOR_KIND[kind];
      if (!field) throw new Error(`unknown kind '${kind}' (use ${Object.keys(FIELD_FOR_KIND).join("|")})`);
      const e = await ledger.append({
        runId, source: "harness", kind, payload: { [field]: text, seeded: true },
      });
      console.log(`✓ ${kind} seq=${e.seq} runId=${runId} ${field}="${text}"`);
      break;
    }
    case "convo": {
      const userText = args[0];
      const edText = args[1];
      if (!userText || !edText) throw new Error('usage: convo "<userText>" "<edText>"');
      const u = await ledger.append({ runId: null, source: "user", kind: "user_utterance", payload: { text: userText, seeded: true } });
      const v = await ledger.append({ runId: null, source: "edmini", kind: "voice_output", payload: { text: edText, seeded: true } });
      console.log(`✓ user_utterance seq=${u.seq} + voice_output seq=${v.seq}`);
      break;
    }
    case "tail": {
      const n = Number(args[0] ?? 12);
      const events = await ledger.snapshot({ limit: 200 });
      for (const e of events.slice(-n)) {
        const p = JSON.stringify(e.payload).slice(0, 80);
        console.log(`seq=${e.seq}\t${e.source}\t${e.kind}\t${e.runId ?? "-"}\t${p}`);
      }
      break;
    }
    default:
      console.log("usage: ledger:seed <dispatch|reply|convo|tail> ...  (see file header)");
      process.exit(1);
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
