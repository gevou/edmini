/**
 * Discord implementation of the bus transport (outbound: edmini -> harness). Posts via the Discord
 * REST API as the edmini bot. v1 transport per docs/architecture/edmini-v1-design.md §4.
 *
 * NOTE: Discord requires a `DiscordBot (...)` User-Agent — without it, Cloudflare returns 403/1010.
 * A run is keyed by the dispatch message id; Discord threads-from-a-message share that id, so
 * answer()/cancel() post into the thread channel addressed by runId.
 */
import { renderOutbound, type BusTransport, type DispatchResult } from "./transport";

const API = "https://discord.com/api/v10";
const USER_AGENT = "DiscordBot (https://github.com/gevou/edmini, 0.1)";

export interface DiscordTransportConfig {
  token: string; // the edmini bot token
  channelId: string; // the #edmini-bus channel id
}

export function createDiscordTransport(cfg: DiscordTransportConfig): BusTransport {
  async function postMessage(channelId: string, content: string): Promise<{ id: string }> {
    const res = await fetch(`${API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${cfg.token}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      throw new Error(`Discord post failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as { id: string };
  }

  return {
    async dispatch(instruction): Promise<DispatchResult> {
      const msg = await postMessage(cfg.channelId, renderOutbound("task_dispatch", { instruction }));
      return { runId: msg.id, messageId: msg.id };
    },
    async answer(runId, text): Promise<void> {
      await postMessage(runId, renderOutbound("answer", { text }));
    },
    async cancel(runId, reason): Promise<void> {
      await postMessage(runId, renderOutbound("cancel", { reason }));
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
