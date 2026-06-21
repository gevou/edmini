import type { Topic } from "./topic-manager";

export async function classifyTopic(utterance: string, topics: Topic[], apiKey?: string): Promise<string> {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("[classify] No API key available — OPENAI_API_KEY env var missing and no x-openai-key header");
    return "general";
  }
  if (topics.length === 0) {
    console.error("[classify] No topics loaded");
    return "general";
  }

  // Exclude the general bucket from classification options
  const classifiableTopics = topics.filter((t) => t.id !== "general");
  if (classifiableTopics.length === 0) return "general";

  const topicList = classifiableTopics
    .map((t) => {
      const recent = t.history.slice(-3).map((m) => `${m.role}: ${m.content}`).join(" | ");
      return `- id: "${t.id}", name: "${t.name}", category: ${t.category}, status: ${t.status}, summary: "${t.summary}"${recent ? `, recent context: "${recent}"` : ""}`;
    })
    .join("\n");

  console.log(`[classify] Classifying utterance: "${utterance}"`);
  console.log(`[classify] Against ${classifiableTopics.length} topics:\n${topicList}`);

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: `You are a conversation classifier for Ed, a personal AI voice agent. Ed manages ongoing work topics for the user. Your job is to classify which topic a user's voice message most likely relates to.

Rules:
- Return ONLY the exact topic id string (e.g. "blog-tds-submission"), nothing else
- If the message clearly relates to one of the listed topics, return that topic's id
- Only return "general" if the message is completely unrelated to ALL topics (e.g. small talk, greetings, unrelated questions)
- Prefer to classify into a specific topic when there's any reasonable match — err on the side of classification over "general"
- Consider the topic name, category, summary, and recent context when matching`,
          },
          {
            role: "user",
            content: `Active topics:\n${topicList}\n\nUser message: "${utterance}"\n\nWhich topic id does this message relate to? Reply with just the id.`,
          },
        ],
      }),
    });
  } catch (err) {
    console.error("[classify] Network error calling OpenAI:", err);
    return "general";
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`[classify] OpenAI API error ${res.status}: ${body}`);
    return "general";
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "general";
  // Strip quotes if model returns them
  const id = raw.replace(/^["']|["']$/g, "");

  const valid = topics.some((t) => t.id === id);
  console.log(`[classify] Result: "${id}" (valid: ${valid})`);
  return valid ? id : "general";
}
