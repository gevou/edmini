# Ed Mini

A lightweight conversational voice agent — a stripped-down version of Edgar focused on natural conversation quality and on serving as a testbed for the supervisor / orchestration layer.

## Vision

Ed is the conversational core of a larger agent system. Focus: making conversation feel natural. Memory, supervisor capabilities, and multi-channel comms build on top.

The UI is laid out and styled for mobile (iPhone/iPad). The voice loop itself works on any modern browser with `getUserMedia` over HTTPS.

## Architecture

Two layers, with a clean seam between them:

- **Voice loop** — runs entirely in the browser via WebRTC to OpenAI's Realtime API. The server only mints ephemeral keys so `OPENAI_API_KEY` never reaches the client.
- **Supervisor** — when the Realtime model fires the `classify_and_route` tool, the request hits `/api/intent/classify`, the supervisor pipeline runs (rephrase → classify → route), and events fan out through a server-side event store to any subscribed UI via SSE.

The supervisor is the load-bearing piece of this repo. See [src/supervisor/README.md](./src/supervisor/README.md) for the contract, transports, and wiring diagram.

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

Open [http://localhost:3000](http://localhost:3000) — works best on Chrome/Safari with mic permission. Open `/dashboard` in a second tab to see the supervisor event log.

### Deploy to Vercel

```bash
vercel deploy
# Set OPENAI_API_KEY in Vercel environment variables
```

Or connect the GitHub repo in Vercel dashboard and set env vars there.

## Stack

- **Next.js 15** — App Router, TypeScript
- **Tailwind CSS v4** — mobile-optimized layout
- **OpenAI Realtime API** — GPT-4o with WebRTC transport
- **Vercel Workflow SDK** — supervisor pipeline durability (see [src/supervisor/README.md](./src/supervisor/README.md))
- **Vercel** — deployment platform
