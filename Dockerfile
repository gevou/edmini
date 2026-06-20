# edmini bus worker (edmini-4vi) — always-on Discord gateway tap → ledger.
# The worker can't run on Vercel (serverless can't hold the gateway); this image runs it on Fly.
# It runs the TypeScript entrypoint directly via tsx — no build step. Env comes from `fly secrets`.
FROM node:22-slim

WORKDIR /app
RUN corepack enable

# Install deps against the pinned pnpm (packageManager in package.json) with the frozen lockfile.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# App source (worker/ + src/lib/*). .dockerignore keeps node_modules/.next/.env* out.
COPY . .

# Long-running process; Fly restarts the machine if it exits.
CMD ["pnpm", "worker"]
