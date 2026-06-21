/**
 * Discord implementation of the bus transport (outbound: edmini -> harness). Posts via the Discord
 * REST API as the edmini bot. v1 transport per docs/architecture/edmini-v1-design.md §4.
 *
 * Run correlation (edmini-oys): dispatch() creates a THREAD per task and posts the instruction into
 * it; the thread id is the run_id. Verified live that Hermes replies inside an edmini-created thread,
 * so every reply lands under the same run_id. answer()/cancel() post into that thread.
 *
 * NOTE: Discord requires a `DiscordBot (...)` User-Agent — without it Cloudflare returns 403/1010.
 */
import { renderOutbound, type BusTransport, type DispatchResult } from "./transport";

const API = "https://discord.com/api/v10";
const USER_AGENT = "DiscordBot (https://github.com/gevou/edmini, 0.1)";
const PUBLIC_THREAD = 11; // Discord channel type
const AUTO_ARCHIVE_MIN = 1440; // 24h

export interface DiscordTransportConfig {
  token: string; // the edmini bot token
  channelId: string; // the #edmini-bus channel id
}

export function createDiscordTransport(cfg: DiscordTransportConfig): BusTransport {
  async function req<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${cfg.token}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Discord POST ${path} failed (${res.status}): ${await res.text()}`);
    return (await res.json()) as T;
  }

  const postMessage = (channelId: string, content: string) =>
    req<{ id: string }>(`/channels/${channelId}/messages`, { content });

  return {
    async dispatch(instruction): Promise<DispatchResult> {
      const name = (instruction.replace(/\s+/g, " ").trim().slice(0, 90)) || "edmini task";
      const thread = await req<{ id: string }>(`/channels/${cfg.channelId}/threads`, {
        name, type: PUBLIC_THREAD, auto_archive_duration: AUTO_ARCHIVE_MIN,
      });
      const msg = await postMessage(thread.id, renderOutbound("task_dispatch", { instruction }));
      return { apiIdentifier: thread.id, messageApiId: msg.id };
    },
    async answer(apiIdentifier, text): Promise<void> {
      await postMessage(apiIdentifier, renderOutbound("answer", { text }));
    },
    async cancel(apiIdentifier, reason): Promise<void> {
      await postMessage(apiIdentifier, renderOutbound("cancel", { reason }));
    },
  };
}

export function discordTransportFromEnv(): BusTransport {
  const token = process.env.EDMINI_DISCORD_BOT_TOKEN;
  const channelId = process.env.EDMINI_BUS_CHANNEL_ID;
  if (!token) throw new Error("EDMINI_DISCORD_BOT_TOKEN is required");
  if (!channelId) throw new Error("EDMINI_BUS_CHANNEL_ID is required");
  return createDiscordTransport({ token, channelId });
}
