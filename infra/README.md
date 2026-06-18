# edmini infrastructure

One-command setup / reset / status for the two pieces of infrastructure edmini v1 depends on:

1. **Hermes** — the executor, talking on a Discord bus (local install, dedicated to this project).
2. **Supabase** — the append-only ledger (system of record).

Everything is **idempotent** and **secret-free in git**: tokens live in gitignored `project.env`
files. Provisioning is automated as far as the platforms allow.

```
infra/
  init.sh                    # ⭐ first-time guided setup: collect 3 secrets, automate the rest
  up.sh                      # idempotent (re)deploy: bootstrap+provision (if needed)+configure+apply
  preflight.sh               # validate tokens / channel / DB / Hermes reachability
  lib.sh                     # shared helpers
  discord/
    bootstrap.sh             # print bot invite URLs; auto-detect the shared server; create #edmini-bus
  hermes/
    project.env.example      # Discord bot tokens + bus config (init.sh fills this)
    configure.sh             # write Discord config into ~/.hermes/.env, restart gateway
    reset.sh                 # backup ~/.hermes, re-apply config, restart  (safe)
    status.sh / send-test.sh
  supabase/
    project.env.example      # Supabase access token + auto-filled connection details
    provision.sh             # auto-create a hosted project from a PAT, write the connection string
    migrations/0001_ledger.sql
    apply.sh                 # apply migrations (psql via SUPABASE_DB_URL, or supabase CLI)
    reset.sh                 # drop + recreate the ledger objects, then apply  (destructive, confirms)
```

## The minimum you provide (everything else is automated)

The **only** irreducible manual work, because the platforms have no API for it:

1. **Two Discord bots.** At <https://discord.com/developers/applications> create two applications
   ("Hermes", "edmini"); for each, enable the **MESSAGE CONTENT INTENT** and copy the bot token.
2. **One Discord server.** Bots cannot create servers (Discord `code 20001`), so make one (Discord →
   "+" → Create My Own) or reuse one, and add **both** bots via the invite URLs `bootstrap.sh` prints.
3. **One Supabase access token.** <https://supabase.com/dashboard/account/tokens>.

Then run the wizard and paste the three tokens:

```bash
./infra/init.sh
```

`init.sh` (via `up.sh`) will: write the gitignored `project.env` files, **auto-create** the Supabase
project + ledger schema, print the **two bot invite URLs**, and — once both bots are in the same
server — **auto-detect** that server and create the `#edmini-bus` channel, then configure Hermes.
First run prints the invites and stops; after you add the bots, **re-run `./infra/up.sh`** to finish.

So: create 2 bots + 1 token, make a server + click 2 invites, run one command (twice). No channel
creation, no hunting for connection strings, no hand-editing files. (Discord auth is bot-token only —
no OAuth login flow; Supabase needs no `supabase login` — the PAT covers it.)

## 1Password (source of truth for the must-provide secrets)

If the 1Password CLI (`op`) is connected, the must-provide secrets live in 1Password, not on disk:
- One-time: connect `op` — enable the 1Password desktop app's **Developer → CLI integration**, or run
  `op account add` (then `op signin`). Verify with `op whoami`.
- `init.sh` then **stores each secret as a 1Password item** (vault from `$OP_VAULT`, default `Private`:
  `edmini-hermes-bot`, `edmini-discord-bot`, `edmini-supabase-pat`) and writes only an `op://`
  **reference** into `project.env` (safe — no raw secret on disk).
- Every script resolves `op://` references at runtime via `op read` (`load_env` in `lib.sh`), so the
  real secrets only ever exist in process memory.
- You can also hand-place references yourself: set e.g.
  `SUPABASE_ACCESS_TOKEN=op://Private/edmini-supabase-pat/credential` in `project.env`.

This governs only the **inputs you provide**. Deployment-derived values (the generated DB password /
`SUPABASE_DB_URL`, and `~/.hermes/.env`) are still written by the provisioners as normal deployment
storage. (For app/worker *runtime* secrets later, the same pattern works via `op run --env-file`.)

## Day-to-day

```bash
./infra/up.sh                  # re-deploy / reconcile everything (idempotent)
./infra/preflight.sh           # is the bus + ledger healthy?
./infra/hermes/send-test.sh "hello"
```

`reset`: `./infra/hermes/reset.sh` (safe: backup + reconfigure) · `./infra/supabase/reset.sh`
(destructive: drops + recreates the ledger; prompts first).

## Notes
- Hermes config lives in `~/.hermes/`. `configure.sh` only manages a delimited `edmini-managed` block
  in `~/.hermes/.env` and backs the file up first — your other Hermes settings are untouched.
- The Hermes gateway runs as a launchd service (`ai.hermes.gateway`); scripts restart it via
  `hermes gateway restart`.
- Bots can't create servers (`code 20001`). `bootstrap.sh` auto-detects the server **both** bots
  share; if they share several, set `EDMINI_GUILD_ID` in `infra/hermes/project.env` to pick one.
- The bot invites request Administrator for simplicity (fine on a dedicated server); scope down if
  you reuse a shared server.
- **Future:** a hosted Hermes test instance so dev doesn't depend on this MacBook (beads `edmini-pmo`).
