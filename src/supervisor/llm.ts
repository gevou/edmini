import { CAPABILITIES } from "./capabilities";
import type { RephrasedResult, RouteDecision } from "./types";
import { getThreads } from "@/lib/thread-manager";
import type { RephrasedResult } from "./types";

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
  };
}
