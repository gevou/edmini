/**
 * Deterministic ledger injector + guided scenarios for session-memory (edmini-iee) live checks.
 *
 *   pnpm ledger:seed scenario <a|b|c>     -> GUIDED: one command per check, prompts you at each browser step
 *
 *   pnpm ledger:seed dispatch <label> [instruction]   -> mints a run, writes task_dispatch, prints runId
 *   pnpm ledger:seed reply <runId> [kind] [text]      -> harness event for a run (default run_done)
 *   pnpm ledger:seed convo "<userText>" "<edText>"    -> a user_utterance + voice_output pair
 *   pnpm ledger:seed tail [n]                          -> print the last n ledger events (default 12)
 *
 * Why: the only thing (b)/(c) really test is an async **harness** event landing in the ledger at a
 * controlled moment — normally produced by the Fly bus worker off a real (slow, non-deterministic) Hermes
 * run. This writes those events directly via the service-role key, so the timing is scriptable and you
 * don't wait on Hermes. The `scenario` commands orchestrate the whole sequence so you just follow prompts.
 * See docs/testing/session-memory-live-checks.md.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (loaded from .env.local).
 *
 * harness render fields (must match NARRATE in VoiceAgent.tsx):
 *   run_done -> payload.summary | run_output -> payload.text | run_blocked -> payload.question | run_failed -> payload.error
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" }); // override with project-local secrets if present
import * as readline from "node:readline/promises";
import { ledgerFromEnv, type Ledger } from "../src/lib/ledger-supabase";
import { mintRunId, mintThreadId } from "../src/lib/ids";

const FIELD_FOR_KIND: Record<string, string> = {
  run_done: "summary",
  run_output: "text",
  run_blocked: "question",
  run_failed: "error",
};

async function pause(instruction: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`\n▶ ${instruction}\n  [Enter to continue] `);
  rl.close();
}

async function seedDispatch(ledger: Ledger, label: string, instruction: string): Promise<string> {
  const runId = mintRunId();
  await ledger.append({
    runId, threadId: mintThreadId(), source: "edmini", kind: "task_dispatch",
    payload: { instruction, label, prevRunId: null, apiIdentifier: null, seeded: true },
  });
  return runId;
}

async function seedReply(ledger: Ledger, runId: string, kind: string, text: string) {
  const field = FIELD_FOR_KIND[kind];
  if (!field) throw new Error(`unknown kind '${kind}' (use ${Object.keys(FIELD_FOR_KIND).join("|")})`);
  return ledger.append({ runId, source: "harness", kind, payload: { [field]: text, seeded: true } });
}

async function seedConvo(ledger: Ledger, userText: string, edText: string) {
  await ledger.append({ runId: null, source: "user", kind: "user_utterance", payload: { text: userText, seeded: true } });
  await ledger.append({ runId: null, source: "edmini", kind: "voice_output", payload: { text: edText, seeded: true } });
}

async function scenario(ledger: Ledger, which: string) {
  switch (which) {
    case "b": {
      console.log("\n=== Check (b) — cross-session delivery (registry-rehydration fix) ===");
      const runId = await seedDispatch(ledger, "research", "look into durable execution");
      console.log(`Seeded dispatch 'research' (${runId}). It exists in the ledger but no UI session dispatched it.`);
      await pause("Start a voice session in the browser. Press Enter once Ed is LISTENING.");
      await seedReply(ledger, runId, "run_done", "found three approaches");
      console.log("✓ Fired run_done.\n  PASS = Ed speaks the research result within ~2s; panel shows Run 'research': run_done.\n  FAIL = silence (the pre-iee dropped-event bug).");
      break;
    }
    case "c": {
      console.log("\n=== Check (c) — catch-up on resume (delivered while audio off) ===");
      const runId = await seedDispatch(ledger, "export", "export the board");
      console.log(`Seeded dispatch 'export' (${runId}).`);
      await pause("Start a session, then STOP it (this sets the lastSeen cutoff). Press Enter once STOPPED.");
      await seedReply(ledger, runId, "run_done", "exported 412 items");
      console.log("✓ Fired run_done while you're 'away' (seq now past the cutoff).");
      await pause("Now START a session again. Press Enter after it connects.");
      console.log("  PASS = within ~2s Ed proactively says 'while you were away, the export finished — exported 412 items.'\n  FAIL = silence.");
      break;
    }
    case "a": {
      console.log("\n=== Check (a) — conversational memory (Recent history + search_history) ===");
      await seedConvo(ledger, "remember the codename is BlueFinch", "got it — BlueFinch");
      for (let i = 1; i <= 14; i++) await seedConvo(ledger, `filler message ${i}`, `ok ${i}`);
      await seedConvo(ledger, "let's plan the launch", "sure — what's the goal?");
      console.log("Seeded: a BlueFinch marker, 14 filler turns (to push it out of the recent window), then a launch-planning turn.");
      await pause("Start a session. Ask: \"what were we just doing?\"  Press Enter when Ed answers.");
      console.log("  PASS = recalls the launch planning, NO tool call (it's in the Recent history block).");
      await pause("Now ask: \"what was the project codename I mentioned earlier?\"  Press Enter when Ed answers.");
      console.log("  PASS = panel shows Tool call: search_history AND Ed says BlueFinch.\n  FAIL = says it doesn't know / never calls the tool.");
      break;
    }
    default:
      throw new Error("usage: scenario <a|b|c>");
  }
  console.log("\n(Seeded events carry payload.seeded:true — clear the events table or filter on it to reset. `pnpm ledger:seed tail 20` to inspect.)");
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const ledger = ledgerFromEnv({ serviceRole: true });

  switch (cmd) {
    case "scenario":
      await scenario(ledger, args[0] ?? "");
      break;
    case "dispatch": {
      const label = args[0];
      if (!label) throw new Error("usage: dispatch <label> [instruction]");
      const instruction = args.slice(1).join(" ") || `seeded task '${label}'`;
      const runId = await seedDispatch(ledger, label, instruction);
      console.log(`✓ task_dispatch label='${label}'\nrunId=${runId}`); // copy this for `reply`
      break;
    }
    case "reply": {
      const runId = args[0];
      const kind = args[1] ?? "run_done";
      const text = args.slice(2).join(" ") || "(seeded harness reply)";
      if (!runId) throw new Error("usage: reply <runId> [run_done|run_output|run_blocked|run_failed] [text]");
      const e = await seedReply(ledger, runId, kind, text);
      console.log(`✓ ${kind} seq=${e.seq} runId=${runId} ${FIELD_FOR_KIND[kind]}="${text}"`);
      break;
    }
    case "convo": {
      const userText = args[0];
      const edText = args[1];
      if (!userText || !edText) throw new Error('usage: convo "<userText>" "<edText>"');
      await seedConvo(ledger, userText, edText);
      console.log(`✓ user_utterance + voice_output`);
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
      console.log("usage: ledger:seed <scenario|dispatch|reply|convo|tail> ...  (see file header)");
      process.exit(1);
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
