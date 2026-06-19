/**
 * edmini bus worker (edmini-2y7) — the always-on inbound tap.
 *
 * Holds the Discord gateway connection (which serverless can't), observes the #edmini-bus channel
 * and its per-run threads, and writes every crossing to the append-only ledger. Harness (Hermes)
 * messages are additionally interpreted (edmini-dze) into normalized envelope events.
 *
 * This is the §0 accountability tap: every happening on the bus becomes a ledger event.
 * Run: pnpm worker   (needs .env.local: EDMINI_DISCORD_BOT_TOKEN, EDMINI_BUS_CHANNEL_ID,
 * SUPABASE_URL/SERVICE_ROLE_KEY, OPENAI_API_KEY for the LLM fallback).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import { interpret, llmClassifierFromEnv, type LlmClassifier } from "../src/lib/bus/interpret";
import { ledgerFromEnv } from "../src/lib/ledger-supabase";

const BUS_CHANNEL_ID = required("EDMINI_BUS_CHANNEL_ID");
const HERMES_USERNAME = process.env.HERMES_BOT_USERNAME ?? "EdHermes";
const ledger = ledgerFromEnv({ serviceRole: true });
const llm: LlmClassifier | undefined = process.env.OPENAI_API_KEY ? llmClassifierFromEnv() : undefined;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required (set it in .env.local)`);
  return v;
}

/** A message belongs to the bus if it's in the bus channel or a thread under it. */
function busRunId(msg: Message): string | null {
  if (msg.channelId === BUS_CHANNEL_ID) return msg.id; // top-level post; thread-from-it shares this id
  const ch = msg.channel;
  if (ch.isThread() && ch.parentId === BUS_CHANNEL_ID) return ch.id; // run = thread id
  return null;
}

async function onMessage(msg: Message): Promise<void> {
  const runId = busRunId(msg);
  if (!runId) return;

  const isHarness = msg.author.username === HERMES_USERNAME;
  const source = isHarness ? "harness" : msg.author.bot ? "edmini" : "user";

  try {
    // 1) raw crossing — always logged (accountability)
    await ledger.append({
      runId,
      source,
      kind: "discord_message",
      payload: { text: msg.content, author: msg.author.username, messageId: msg.id },
    });

    // 2) interpret harness messages into normalized envelopes
    if (isHarness && msg.content.trim()) {
      const r = await interpret(msg.content, llm);
      console.log(`[worker] ${runId} harness → ${r.kind} (${r.via})`);
      if (r.kind !== "ignore") {
        await ledger.append({
          runId,
          source: "harness",
          kind: r.kind,
          payload: { ...r.payload, via: r.via, confidence: r.confidence },
        });
      }
    }
  } catch (err) {
    console.error(`[worker] failed handling message ${msg.id}:`, err instanceof Error ? err.message : err);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, (c) => {
  console.log(`[worker] ready as ${c.user.tag}; tapping bus channel ${BUS_CHANNEL_ID}`);
});
client.on(Events.MessageCreate, (msg) => void onMessage(msg));
client.on(Events.Error, (e) => console.error("[worker] client error:", e.message));

client.login(required("EDMINI_DISCORD_BOT_TOKEN"));
