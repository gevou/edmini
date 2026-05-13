const TAVILY_URL = "https://api.tavily.com/search";
const TELEGRAM_URL = "https://api.telegram.org";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export async function tavilySearch(query: string): Promise<TavilyResult[]> {
  "use step";
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: 3,
      search_depth: "basic",
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status}`);
  }

  const data = (await res.json()) as { results: TavilyResult[] };
  return data.results;
}

export async function sendTelegram(message: string): Promise<void> {
  "use step";
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set");
  }
  const res = await fetch(`${TELEGRAM_URL}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Telegram send failed: ${res.status} ${detail}`);
  }
}
