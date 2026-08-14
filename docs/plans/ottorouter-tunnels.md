# OttoRouter Managed Tunnels (agi side)

Companion doc: `docs/plans/tunnels.md` in the setu repo (OttoRouter API side).

## Goal

Replace the anonymous TryCloudflare quick-tunnel model with a managed tunnel
system for users authenticated with OttoRouter:

- **One Cloudflare named tunnel per device/daemon**, provisioned by OttoRouter.
- **One stable hostname per device**: `https://<device-slug>.ottorouter.org`
  (one label deep, covered by Universal SSL — no cert cost).
- **One ingress rule** pointing at the local daemon port. The port is
  resolved at runtime via `getServerPort()` (daemon default `47477`, from
  `OTTO_DAEMON_PORT` / `otto service start --port`) and sent to setu at
  provision time — never hardcoded. Ingress only changes if the daemon port
  changes (re-provision re-PUTs it).
- **All scoping moves to daemon-side auth**: a daemon token gates full
  remote-control access; per-project share tokens gate project-scoped access.
- Quick tunnels (TryCloudflare) remain available, but only as an **explicit UI
  option** shown when OttoRouter is not connected. There is no silent runtime
  fallback from managed to quick.

## Current state

- `packages/sdk/src/tunnel/binary.ts` — downloads `cloudflared` to the otto bin
  dir as `tunnel`. Unchanged by this plan (same binary runs named tunnels).
- `packages/sdk/src/tunnel/tunnel.ts` — `OttoTunnel` spawns
  `tunnel tunnel --url http://localhost:PORT` (quick tunnel), scrapes the
  `*.trycloudflare.com` URL from stdout, handles rate limiting.
- `packages/server/src/routes/tunnel/service.ts` — `TunnelSlot` map keyed by
  scope: one `remote-control` slot (whole server) plus N `project-share` slots.
  Each slot owns its own `cloudflared` process. Project shares spin up a local
  proxy (`startProjectScopeProxy`) that pins `projectId` and blocks
  `/v1/projects*` and `/v1/tunnel*`, then tunnels the proxy port.
- `packages/server/src/routes/tunnel.ts` — Zod OpenAPI routes:
  status/start/stop/register/qr/stream, all scope-aware.
- `packages/server/src/routes/root.ts` — existing daemon token concept:
  `~/.otto/server-token` checked for `/v1/server/info` when `OTTO_DAEMON_ID`
  is set. Reuse/extend this for tunnel auth.
- `packages/server/src/routes/ottorouter/service.ts` —
  `getOttoRouterOAuthAuth()` returns a refreshed OttoRouter access token.
  This is how the tunnel client authenticates to setu.

## Target architecture

```
browser ──► <slug>.ottorouter.org ──► Cloudflare edge ──► cloudflared (device)
                                                              │ (single process,
                                                              │  tunnel run --token)
                                                              ▼
                                                otto daemon :47477 (default)
                                                              │
                                              tunnel-auth middleware
                                              ├── daemon token  → full access
                                              ├── share token   → project-scoped
                                              └── none          → 401 / login page
```

- The daemon runs **one** `cloudflared tunnel run --token <token>` process,
  started lazily when the user enables the tunnel, kept alive while enabled.
- The tunnel token and hostname come from OttoRouter
  (`POST /v1/tunnels/device`), authenticated with the stored OttoRouter OAuth
  token. The call is idempotent per device and machine — agi does not persist
  the tunnel token, it re-requests it on each start.
- Project shares no longer need the local proxy or their own tunnel process in
  managed mode: sharing a project = minting a share token locally. Start/stop
  is instant, no Cloudflare interaction.

## Device identity

- Persist a generated Otto instance UUID under the Otto home dir as
  `device-id` and a separate connector UUID as `machine-id`. Provisioning
  sends both as `device_id` and `machine_id`, allowing multiple machines for
  one account or Otto instance to remain independently listable and usable.
- setu maps `(device_id, machine_id)` → short random slug (8–10 chars, not the
  UUIDs; the slug is rotatable server-side without changing either identity).

## Workstreams

### 1. Daemon tunnel auth (prerequisite, independent of setu)

New middleware in `packages/server/src/` applied before all routes:

- **Tunnel request detection**: request `Host` is not
  localhost/127.0.0.1/[::1] (optionally corroborated by `CF-Ray` /
  `CF-Connecting-IP`). Local requests bypass tunnel auth entirely — no change
  for local clients.
- **Daemon token** (full access): reuse the `~/.otto/server-token` file
  (`packages/server/src/routes/root.ts:17`), generated on daemon start if
  missing. Accept via `Authorization: Bearer`, `x-otto-server-token` header,
  or a cookie set by the web UI login flow. Optional user-set password can be
  layered later; v1 is the generated token.
- **Share tokens** (project-scoped): random tokens (32+ bytes, base64url)
  minted per project share, kept in daemon memory (die with the daemon, like
  tunnel slots today). A request bearing a share token:
  - is pinned to that share's `projectId` (inject `x-otto-project-id`,
    override any client-supplied project param — same semantics as
    `startProjectScopeProxy` in
    `packages/server/src/routes/tunnel/service.ts:120`),
  - is blocked from `/v1/projects*` and `/v1/tunnel*` (move
    `isBlockedProjectSharePath` into the middleware),
  - is allowed to load web UI static assets.
- **Unauthenticated tunnel request**: 401 JSON for API paths; for browser
  navigation, serve the web UI which shows a token/password entry screen.

Share token routes (new, under `/v1/tunnel/shares`):

- `POST /v1/tunnel/shares` `{ projectId }` → `{ token, url }` where
  `url = https://<hostname>/sessions?share=<token>`
- `GET /v1/tunnel/shares` → active shares
- `DELETE /v1/tunnel/shares/:id` → revoke

These routes are themselves blocked over share-token auth (daemon token or
local only).

### 2. Managed tunnel client (sdk)

New module `packages/sdk/src/tunnel/managed.ts`:

- `provisionManagedTunnel(auth)` — calls setu
  `POST /v1/tunnels/device { device_id, daemon_version, local_port }` with the
  OttoRouter bearer token, returns `{ slug, hostname, tunnel_token }`.
- Extend `OttoTunnel` with a managed start path: spawn
  `tunnel tunnel run --token <token>` (same binary from `binary.ts`). The URL
  is known from the API response — no stdout URL scraping; stdout/stderr
  parsing is only for connection/health events (`Connection ...` lines are
  identical for named tunnels).
- Keep the quick-tunnel start path untouched for the explicit quick option.
- Readiness: resolve start once cloudflared reports a registered connection
  (reuse `CONN_REGEX` handling), with the existing 30s timeout.

### 3. Server tunnel service rework

`packages/server/src/routes/tunnel/service.ts`:

- Introduce a tunnel **mode**: `managed` (OttoRouter) vs `quick`
  (TryCloudflare). Mode is chosen by the caller (UI), not auto-fallback.
- **Managed mode**:
  - Single tunnel state for the daemon (no slot map for processes): status,
    hostname, error, progress.
  - `startTunnel({ mode: 'managed' })` → OttoRouter auth check (via
    `getOttoRouterOAuthAuth`); if absent, return a typed error the UI maps to
    "connect OttoRouter or use quick tunnel".
  - Project share start/stop = share token create/revoke (workstream 1). The
    `project-share` scope in the API keeps working but returns
    `https://<hostname>/sessions?share=<token>` as its URL, and starts the managed
    tunnel if not already running.
  - Remove per-share proxy servers in managed mode.
- **Quick mode**: existing per-slot process + proxy behavior preserved as-is.
- `stopActiveTunnel()` on shutdown also revokes in-memory shares (implicit —
  they are in-memory).

### 4. API routes + client regen

`packages/server/src/routes/tunnel.ts`:

- `startTunnelBodySchema` gains `mode: z.enum(['managed', 'quick']).optional()`.
- Status schema gains `mode`, `hostname`, and `ottorouterConnected: boolean`
  so the UI can decide what to offer.
- New share routes (workstream 1) registered via `zodOpenApiRoute`.
- Regenerate: `bun run --filter @ottocode/api generate`.

### 5. Web UI (`packages/web-sdk`)

- `TunnelSidebar`:
  - OttoRouter connected → managed tunnel is the primary action; show stable
    hostname; project shares listed with copy-link + revoke.
  - OttoRouter not connected → show "Connect OttoRouter for stable tunnels"
    CTA (links to existing OttoRouter auth flow) **and** a secondary explicit
    "Use quick tunnel (temporary URL)" option. No automatic fallback.
- Share-mode boot: when the app loads with `?share=<token>`, store the share
  token (scoped storage key, never the daemon token), strip it from the URL,
  attach it to all API calls, and pin the UI to the shared project.
- Daemon login screen: unauthenticated tunnel visitors get a token/password
  entry that validates against the daemon token and sets the auth cookie.
- QR code flow unchanged (URL now stable).

### 6. Cleanup / lifecycle

- On daemon shutdown: stop cloudflared (existing `stopActiveTunnel` wiring in
  server index).
- `DELETE` device on setu (revoke + slug rotation) exposed later via UI
  ("rotate tunnel URL"), maps to setu `POST /v1/tunnels/device/rotate`.
- Stale-process kill (`killStaleTunnels`) updated to also match
  `tunnel run --token` processes.

## Security notes

- Stable hostname means the daemon is permanently reachable — tunnel auth
  middleware (workstream 1) is **mandatory before** shipping managed tunnels;
  land it first and apply it to quick tunnels too so there is one auth story.
- Share visitors and owner share an origin. The share-mode boot must never
  read or write the daemon token storage key; keep the keys distinct and the
  share key namespaced per token.
- Share tokens: in-memory only, revocable, optional TTL (default none in v1).
- Tunnel token from setu is held in memory only; never written to disk or
  logged.

## Phasing

1. **Phase 1 — daemon tunnel auth** (no setu dependency): middleware, daemon
   token reuse, share tokens + routes, web UI login + share boot. Apply to
   existing quick tunnels.
2. **Phase 2 — managed tunnels**: sdk managed client, service mode split,
   route/schema changes, API regen, UI primary/secondary tunnel options.
   Depends on setu `POST /v1/tunnels/device` being live.
3. **Phase 3 — polish**: rotate-URL UI, share TTLs, optional user-set daemon
   password, docs (`docs/` updates for tunnel behavior).

## Testing

- `tests/` (bun:test): tunnel-auth middleware unit tests (local bypass, daemon
  token, share pinning + blocklist, 401), share route tests, service mode
  tests using `tunnelTesting.setTunnelFactory`.
- Manual: managed tunnel end-to-end against setu dev
  (`OTTOROUTER_BASE_URL=http://localhost:4002`), share link in incognito,
  revoke mid-session, quick tunnel option still works unauthenticated.
