import type { Thread } from "./thread-manager";

export async function classifyThread(utterance: string, threads: Thread[], apiKey?: string): Promise<string> {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key || threads.length === 0) return "general";

  const threadList = threads
    .map((t) => {
      const recent = t.history.slice(-2).map((m) => `${m.role}: ${m.content}`).join(" | ");
      return `- id: ${t.id}, name: ${t.name}, summary: ${t.summary}${recent ? `, recent: ${recent}` : ""}`;
    })
    .join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 50,
      messages: [
        {
          role: "system",
          content:
            'You are a thread classifier. Given the user\'s message and the list of active threads, return ONLY the thread ID that this message most likely refers to. If it doesn\'t match any thread, return "general". Return only the ID, nothing else.',
        },
        {
          role: "user",
          content: `Threads:\n${threadList}\n\nUser message: "${utterance}"`,
        },
      ],
    }),
  });

  if (!res.ok) return "general";

  const data = await res.json() as { choices: { message: { content: string } }[] };
  const id = data.choices?.[0]?.message?.content?.trim() ?? "general";

  const valid = threads.some((t) => t.id === id);
  return valid ? id : "general";
}
