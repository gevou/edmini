
import type { RephrasedResult } from "./types";
import { getThreads } from "@/lib/thread-manager";

/* -------------------------------------------------------------------------- */
/* Step 1 — Rephrase                                                          */
/* -------------------------------------------------------------------------- */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function openaiHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  };
}

function buildThreadList(): string {
  const threads = getThreads().filter((t) => t.id !== "general");
  if (threads.length === 0) return "No known threads yet — return empty array.";
  return threads.map((t) => `- id: "${t.id}", name: "${t.name}", summary: "${t.summary}"`).join("\n");
}

const REPHRASE_SCHEMA = {
  name: "rephrase",
  strict: true,
  schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Cleaned-up intent statement" },
      confidence: { type: "number", description: "0-1 confidence score" },
      ack: { type: "string", description: "Brief verbal confirmation for the user (1 sentence, spoken aloud by Ed)" },
    },
    required: ["text", "confidence", "ack"],
    additionalProperties: false,
  },
} as const;

export async function callRephrase(transcript: string): Promise<RephrasedResult> {
  console.log(buildThreadList());
  const systemPrompt = `You are a voice-input normalizer for Ed, a personal AI assistant.

Given a raw voice transcript, produce structured JSON:

**text**: Rewrite the transcript as a clean, unambiguous intent statement.
- Remove filler words (um, uh, like, you know), false starts, and repetitions.
- If the user is requesting an action, phrase it as a directive that another agent can execute (e.g. "Search the web for X", "Send a message to Y about Z").
- If conversational, preserve the meaning concisely.

**confidence**: How confident you are in your interpretation (0-1).
- 1.0: unambiguous, single clear meaning.
- 0.7-0.9: likely correct but some ambiguity.
- Below 0.5: genuinely unclear what the user wants.

**ack**: A brief, natural verbal confirmation Ed will speak aloud (1 sentence).
- Mirror back the intent so the user knows they were understood.
- Examples: "Searching for TDS submission guidelines.", "I'll send that message.", "Checking on the hackathon status."
- Keep it short — this is spoken while processing continues in the background.`;

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: openaiHeaders(),
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 150,
      response_format: { type: "json_schema", json_schema: REPHRASE_SCHEMA },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcript },
      ],
    }),
  });

  const json = await res.json();
  const parsed = JSON.parse(json.choices[0].message.content) as {
    text: string;
    confidence: number;
    ack: string;
  };
  return {
    text: parsed.text,
    threadIds: [],
    confidence: parsed.confidence,
    ack: parsed.ack,
  };
}

/* -------------------------------------------------------------------------- */
/* Step 2 — Decide and execute via tool calling                               */
/* -------------------------------------------------------------------------- */

const DECIDE_PROMPT = `You are Ed, a personal assistant. Given a user intent, either call one of your available tools or respond that you cannot help. Be concise.`;

const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description: "Search the web for information.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_message",
      description: "Compose and send a message via Telegram.",
      parameters: {
        type: "object",
        properties: {
          recipient: { type: "string", description: "Who to send to" },
          body: { type: "string", description: "The message content" },
        },
        required: ["body"],
      },
    },
  },
];

export interface DecideResult {
  capability: string | null;
  params: Record<string, unknown>;
  fallbackText: string | null;
}

export async function callDecideAndExecute(
  rephrased: RephrasedResult,
): Promise<DecideResult> {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: openaiHeaders(),
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 100,
      tools: TOOL_DEFS,
      tool_choice: "auto",
      messages: [
        { role: "system", content: DECIDE_PROMPT },
        { role: "user", content: rephrased.text },
      ],
    }),
  });

  const json = await res.json();
  const choice = json.choices[0];

  if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length > 0) {
    const call = choice.message.tool_calls[0];
    const params = JSON.parse(call.function.arguments) as Record<string, unknown>;
    console.log(call.function.name);
    console.log(params);
    return {
      capability: call.function.name,
      params,
      fallbackText: null,
    };
  }

  return {
    capability: null,
    params: {},
    fallbackText: choice.message.content ?? "I'm not sure how to help with that.",
  };
}
