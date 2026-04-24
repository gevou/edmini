# Ed Mini

A minimal conversational voice agent focused on natural conversation quality. Mobile-first (iPhone/iPad).

## Vision

Ed is the conversational core of a larger agent system. Focus: making conversation feel natural. Memory, supervisor capabilities, and multi-channel comms build on top.

## Hackathon Origins

- Ship to Prod (Apr 24, 2026): Conversational core
- Cognee AI-Memory (Apr 25, 2026): Persistent cross-conversation memory

---

## Architecture

```
Browser                          Server                      OpenAI
───────                          ──────                      ──────
Mic audio ──► RTCPeerConnection ──────────────────────────► Realtime API
             ◄── Audio stream ◄───────────────────────────── (GPT-4o)
             ◄── Transcripts ◄── DataChannel events ◄───────
                                  POST /api/session
                                  (mints ephemeral key,
                                   keeps OPENAI_API_KEY safe)
```

**Flow:**
1. Browser POSTs `/api/session` → server fetches ephemeral key from OpenAI (API key never exposed to client)
2. Browser creates `RTCPeerConnection`, adds mic track, creates data channel
3. SDP offer sent to `api.openai.com/v1/realtime` with ephemeral key
4. OpenAI returns SDP answer → WebRTC connected
5. Server-side VAD detects speech → sends audio to GPT-4o Realtime
6. GPT-4o streams audio response back + text events over data channel
7. Transcript displayed in real time

**VAD config:** `threshold: 0.5`, `silence_duration_ms: 2000`, `prefix_padding_ms: 300`

## Setup

### Prerequisites

- Node.js 20+
- pnpm (`npm i -g pnpm`)
- OpenAI API key with Realtime API access

### Local development

```bash
cp .env.example .env.local
# edit .env.local with your OPENAI_API_KEY

pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) — works best on Chrome/Safari with mic permission.

### Deploy to Vercel

```bash
vercel deploy
# Set OPENAI_API_KEY in Vercel environment variables
```

Or connect the GitHub repo in Vercel dashboard and set env vars there.

## Stack

- **Next.js 15** — App Router, TypeScript
- **Tailwind CSS v4** — mobile-first styling
- **OpenAI Realtime API** — GPT-4o with WebRTC transport
- **Vercel** — deployment platform

