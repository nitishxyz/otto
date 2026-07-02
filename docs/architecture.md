# Architecture

[← Back to README](../README.md) · [Docs Index](./index.md)

otto is a Bun workspace monorepo with multiple product surfaces sharing one local-first runtime.

---

## High-level flow

1. The CLI ensures a shared local daemon is running and opens the current project.
2. The server resolves every request to a project runtime, persists sessions/messages in that project's DB, resolves providers, prepares tools, and streams model output.
3. Clients such as the TUI, web UI, desktop app, and embedded consumers talk to the same HTTP API with explicit project context.
4. Shared packages provide auth, config, providers, prompts, API generation, and web assets.

The compiled CLI bundles the server, database, daemon service, and web UI assets into a single executable. `otto serve` remains available for manual foreground serving.

---

## Daemon and project model

otto's default local process model is one daemon per user. The daemon listens on `127.0.0.1`, stores its registration in the global otto state directory, and serves many projects in one process. Daemon startup binds the documented default port `47477`; if that port is unavailable, startup fails and no new registration is written. `OTTO_DAEMON_PORT` or `otto service start --port <port>` can change the required port, but clients should still read `server.json`/status instead of assuming a port.

Daemon files:

- `server.json` — daemon id, version, URL, PID, and start time
- `server-token` — random local token written with restrictive permissions

CLI startup flow:

1. resolve the current project path
2. reuse a healthy daemon with a matching version or start one detached
3. authenticate with the local server token
4. call `POST /v1/projects/open` for the selected project
5. launch TUI/web/ask with `baseUrl`, auth headers, `projectId`, and `projectRoot`

Project state remains local-first and per project. Each `ProjectRuntime` owns its config, SQLite DB handle, and scoped runtime resources for the selected project. Known projects are tracked in the persisted registry so recent projects are available after daemon restart.

Project context can be sent as either:

- `projectId=<id>` query parameter
- `project=<absolute-path>` query parameter for compatibility
- `X-Otto-Project-Id` header
- `X-Otto-Project` header for compatibility

First-party clients prefer `projectId`. The legacy `?project=` path form is still supported for external scripts and older clients. The only compatibility fallback to process cwd lives in the centralized server project resolver.

---

## Workspace layout

```text
otto/
├── apps/
│   ├── cli/
│   ├── desktop/
│   ├── intro-video/
│   ├── landing/
│   ├── launcher/
│   ├── mobile/
│   ├── preview-api/
│   ├── preview-web/
│   ├── tui/
│   └── web/
├── packages/
│   ├── acp/
│   ├── ai-sdk/
│   ├── api/
│   ├── database/
│   ├── install/
│   ├── openclaw-ottorouter/
│   ├── sdk/
│   ├── server/
│   ├── web-sdk/
│   └── web-ui/
├── infra/
├── functions/
│   └── og/
├── examples/
├── tests/
├── scripts/
├── reference/
└── docs/
```

---

## Apps

### `apps/cli`

Main CLI binary.

- Commander-based CLI
- ensures/reuses the local daemon for default TUI/web/ask flows
- opens the current project through daemon project routes
- launches the TUI by default
- can also run `serve`, service/project management, auth flows, scaffolding, sessions, tools, MCP, and more

### `apps/tui`

Terminal UI client for the otto API.

- OpenTUI + React
- consumes `@ottocode/api`
- default user experience for `otto`

### `apps/web`

Browser client for the otto API.

- React + Vite
- built into static assets that are packaged by `@ottocode/web-ui`

### `apps/desktop`

Desktop wrapper around the local otto workflow.

- Tauri v2
- embeds the CLI binary and web UI assets

### `apps/launcher`

Launcher-oriented desktop surface for discovering/running local services and ports.

### `apps/mobile`

Mobile client workspace.

### `apps/landing`

Marketing/docs site workspace.

### `apps/intro-video`

Video generation workspace for intro/marketing assets.

### `apps/preview-api`

Session sharing backend.

### `apps/preview-web`

Public session viewer frontend.

---

## Packages

### `@ottocode/sdk`

Core reusable runtime pieces:

- provider catalog + auth helpers
- config/path utilities
- prompt assets
- built-in tools and tool discovery
- terminal manager
- MCP and skill loading primitives

### `@ottocode/server`

Hono server runtime.

Key responsibilities:

- route registration under `/v1/*`
- daemon health/runtime metadata
- project manager and project registry routes
- session/message orchestration
- SSE streaming
- agent resolution and prompt composition
- tool execution and approvals
- OpenAPI generation
- looper orchestration: project-scoped goals with per-goal looper sessions
  (`goals.looperSessionId`); looper is the sole writer of goal state and
  dispatches tasks to worker agents via async delegation

Exports include:

- `createApp`
- `createStandaloneApp`
- `createEmbeddedApp`
- `BUILTIN_AGENTS`
- `BUILTIN_TOOLS`

### `@ottocode/database`

SQLite + Drizzle ORM local persistence.

- sessions/messages/artifacts/goals/subagents schema
- bundled migrations
- DB bootstrap helpers

### `@ottocode/api`

Generated API client package.

- generated from the server's Zod OpenAPI routes registered via
  `packages/server/src/openapi/route.ts` and exposed by
  `packages/server/src/routes/openapi.ts`
- publishes `packages/api/openapi.json`
- intended client for first-party consumers

### `@ottocode/web-sdk`

Reusable React hooks, stores, and UI components for otto-style web interfaces.

### `@ottocode/web-ui`

Prebuilt static web assets and `serveWebUI()` helper for embedding the browser UI.

### `@ottocode/install`

Install helper package that downloads the correct binary release.

### `@ottocode/acp`

ACP adapter for editor/client integrations.

### `@ottocode/ai-sdk`

Companion package/versioning surface for AI SDK-related integration.

### `@ottocode/openclaw`

OttoRouter integration package for OpenClaw workflows.

---

## API shape

The server currently exposes:

- `/`
- `/openapi.json`
- `/v1/*`

Major route groups include:

- `ask`
- `auth`
- `config`
- `doctor`
- `files`
- `git`
- `mcp`
- `projects`
- `provider-usage`
- `research`
- `sessions`
- `ottorouter`
- `shares`
- `skills`
- `terminals`
- `tunnel`

When the API changes:

1. update route handlers in `packages/server/src/routes/`
2. update the route's Zod OpenAPI schemas registered with
   `zodOpenApiRoute(...)`
3. regenerate the client with:

```bash
bun run --filter @ottocode/api generate
```

---

## Built-in agents

The server exports built-in presets that align with runtime defaults:

- `build`
- `plan`
- `general`
- `research`

Prompt overrides can come from:

- `.otto/agents/<name>.md`
- `.otto/agents/<name>.txt`
- `~/.config/otto/agents/<name>.md`
- `~/.config/otto/agents/<name>.txt`
- `.otto/agents.json`
- `~/.config/otto/agents.json`

---

## Built-in tools

Core built-ins include:

- note: this is the overall built-in tool universe, not the tool list granted to every agent

- file tools: `read`, `write`, `ls`, `tree`, `pwd`, `cd`, `glob`
- search/web: `search`, `websearch`
- editing: `apply_patch`
- runtime: `shell`, `terminal`
- git: `git_status`, `git_diff`, `git_commit`
- agent control: `update_todos`, `progress_update`, `finish`, `skill`
- research helpers: `query_sessions`, `query_messages`, `get_session_context`, `search_history`, `get_parent_session`, `present_action`

Custom tools are loaded from project/global tool directories as `tool.js` or `tool.mjs` plugins.

---

## Config and auth paths

### Config

- global config dir: `~/.config/otto/`
- global state dir: `~/.local/state/otto/` on Linux/macOS
- project dir: `.otto/`
- daemon registration: `~/.local/state/otto/server.json`
- daemon token: `~/.local/state/otto/server-token`
- known projects registry: `~/.config/otto/projects.json`

### Secure auth

- macOS: `~/Library/Application Support/otto/auth.json`
- Linux: `$XDG_STATE_HOME/otto/auth.json` or `~/.local/state/otto/auth.json`
- Windows: `%APPDATA%/otto/auth.json`

### Secure OAuth storage

- macOS: `~/Library/Application Support/otto/oauth/`
- Linux: `$XDG_STATE_HOME/otto/oauth/` or `~/.local/state/otto/oauth/`
- Windows: `%APPDATA%/otto/oauth/`

---

## Dependency guidance

Within the monorepo, follow the package layering documented in `AGENTS.md`:

- level 0: `database`, `install`
- level 1: `sdk`
- level 2: `api`
- level 3: `server`
- level 4: `web-sdk`
- level 5: CLI / app consumers

Use workspace imports like `@ottocode/server` across packages and relative imports only within the same package.

---

## Infrastructure

SST currently imports these modules from `sst.config.ts`:

- `infra/script`
- `infra/landing`
- `infra/preview-api`
- `infra/preview-web`
- `infra/og`

Notable top-level infra-related areas:

- `infra/` — SST definitions
- `functions/og` — OG rendering function code

Example commands:

```bash
bun sst dev
bun sst deploy --stage prod
```
