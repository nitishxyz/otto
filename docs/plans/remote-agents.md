# Remote Agents — Always-On Control Plane + Turso Sync

Requirements that shape everything:

1. Trigger remote agents from any client (local otto, mobile app, web) via a
   simple toggle when creating a session / sending a message.
2. **Keep running when the local machine is closed** — so the local otto server
   cannot be the broker; an always-on control plane must own the job.
3. Any client (mobile, laptop, web) can later see what happened, ideally with
   local otto state reflecting the remote session.

## Identity: reuse OttoRouter, layer Better Auth for devices

Every otto install already has a self-sovereign account: the **OttoRouter
Solana wallet** (`packages/sdk/src/auth/src/wallet.ts` — keypair in
`auth.json`, signature-based auth, billing/credits already live on OttoRouter).

Recommendation: **remote agents become an OttoRouter-adjacent service** using
the wallet as the root identity, with **Better Auth on the control plane for
device sessions** (mobile already depends on `better-auth` in `apps/mobile`):

- Wallet pubkey = account. CLI/desktop authenticate by signing a challenge
  (same as OttoRouter today).
- Better Auth issues device sessions (passkey/email or QR-link from a
  wallet-holding device) so the mobile app gets normal login UX; each device
  links to the wallet account.
- Billing for machines + LLM usage rides the existing OttoRouter credit system
  — no second billing integration.

**The killer simplification:** if remote agents route LLM calls through
OttoRouter, **no provider credentials need to leave your machine at all.** The
sandbox only needs a scoped OttoRouter token minted by the control plane.
Syncing full `auth.json` (for people who insist on direct Anthropic/OpenAI
keys) becomes an opt-in escrow feature (client-side encrypted blob the control
plane stores but cannot read; sandbox gets the key at inject time), not the
default.

## Persistence: Turso per-session DBs with embedded replicas

otto's session store is already SQLite + Drizzle (`packages/database`,
`bun:sqlite`). Turso/libSQL **embedded replicas** fit this exactly:

- Each remote session (or machine) gets its **own Turso database**, created by
  the control plane with a scoped token. Turso is built for
  thousands-of-small-DBs.
- The remote otto opens it as an embedded replica: local SQLite file for
  fast writes, continuous sync up to Turso. Change is contained to
  `getDbByPath()` in `packages/database/src/index.ts` (swap `bun:sqlite` for
  `@libsql/client` + `drizzle-orm/libsql` when a `syncUrl` is present) — the
  schema and all queries stay identical.
- **Sync-down is how clients "see what happened":** local otto and mobile pull
  a read replica of the session DB (or query Turso directly over HTTP) and
  render it with the existing message/session UI. No custom event-log
  protocol; the DB is the protocol.
- Live tailing while a run is active: SSE relay through the control plane
  (or poll replica sync at short intervals — v1 can start there).
- Local otto lists remote sessions alongside local ones: a `remote_sessions`
  mirror table pointing at the Turso DB + last-synced cursor.

## Architecture

```
clients: local otto UI / TUI / mobile app / web
   │  toggle: runtime = local | remote
   │  auth: wallet-sig (CLI/desktop) or Better Auth device session (mobile)
   ▼
┌──────────────────── control plane (always-on, hosted) ────────────────────┐
│ agents service (Hono) — could live beside OttoRouter                      │
│  • Better Auth (device sessions) linked to wallet accounts                │
│  • registry (Turso): accounts, devices, machines, jobs, budgets           │
│  • provisions Turso DB per session + scoped tokens                        │
│  • SandboxDriver: fly | docker(byo box) | vercel-sandbox | daytona        │
│  • mints scoped OttoRouter token per job (LLM access, spend-capped)       │
│  • GitHub App: installation tokens for clone + PR as otto-agent[bot]      │
│  • SSE fanout for live tailing; webhook/push notifications on finish      │
└──────────────┬─────────────────────────────────────────────────────────────┘
               ▼
┌──────────── remote sandbox (otto-agent image: git+bun+node+otto) ──────────┐
│ 1. clone repo (GitHub App token) at requested ref                          │
│ 2. otto serve --api-only with DB = libSQL embedded replica (syncUrl=Turso) │
│ 3. run session loop (yolo approval inside sandbox)                         │
│ 4. branch otto/<slug> → push → PR via GitHub App                           │
│ 5. idle timeout → scale to zero; DB state lives on in Turso                │
└─────────────────────────────────────────────────────────────────────────────┘
               ▲
   laptop closed? doesn't matter — loop + state are remote.
   later: mobile opens the session → reads Turso replica → full transcript.
```

### Flow: the toggle

1. Any client sends `POST /v1/jobs` (control plane) or flips `runtime: remote`
   in the composer — local otto forwards to the control plane instead of
   running locally.
2. Control plane: create Turso DB → mint tokens (Turso, OttoRouter, GitHub) →
   provision machine → inject → go.
3. Client tails via SSE or replica sync. Close the laptop whenever.
4. On completion: PR opened, push notification to devices, machine reclaimed.
5. Next time local otto opens, it syncs the session down and shows it in the
   normal session list (marked remote, with PR link).

### Why not "just Better Auth from scratch" or "just GitHub Actions"

- A fresh accounts system duplicates identity+billing OttoRouter already has;
  Better Auth alone still needs a payment story for machine time.
- GitHub Actions: unreliable, trigger-shaped wrong, no live steering, no
  mobile story — dropped.
- Local-otto-as-broker (previous draft): dies with the lid. Kept only as the
  degenerate case: the docker driver can still target your own box for
  self-hosted runs, but the job record lives in the control plane.

## What must be built

| # | Item | Where |
|---|------|-------|
| 1 | libSQL/embedded-replica support in `getDbByPath` (syncUrl option) | `packages/database` |
| 2 | `otto-agent` OCI image + entrypoint (clone, serve, finish→PR) | new `docker/` or `packages/remote` |
| 3 | agents service: Better Auth + wallet link, registry schema (Turso), job API, SandboxDriver (fly first, docker byo second), token minting, SSE fanout | new app (beside OttoRouter or `apps/agents-api`) |
| 4 | GitHub App (clone + PR) | agents service |
| 5 | Client: runtime toggle in composer (web-sdk), remote session mirror + sync-down in local otto, session list badges | `packages/web-sdk`, `packages/server` |
| 6 | Mobile: job trigger + transcript viewer over Turso/control-plane API | `apps/mobile` |
| 7 | Scoped OttoRouter job tokens (spend-capped) | OttoRouter side |

Suggested order: 1 → 2 → 3 (fly driver) → 4 → 5, mobile (6) after the API is
stable. Opt-in creds escrow for non-OttoRouter providers comes last.

## Risks / open questions

- **Turso embedded replica with Bun**: verify `@libsql/client` sync works well
  under Bun in the sandbox image; fallback is plain remote libSQL (no local
  file) at some latency cost.
- **One DB per session vs per account**: per-session gives clean token scoping
  and cheap deletion; per-account simplifies listing. Leaning per-session +
  a small per-account index DB.
- **Scoped OttoRouter tokens** don't exist yet (today: wallet signs directly).
  Needs a delegation/token mint on OttoRouter — required so a compromised
  sandbox can only spend its job budget.
- **Steering mid-run** (send follow-up message while remote loop is active)
  goes through the control plane to the sandbox's otto server — needs the
  machine to stay reachable (fly private networking makes this easy).
- **Dirty/unpushed local work** can't run remotely in v1 (remote clones the
  pushed ref). `git bundle` upload later.
