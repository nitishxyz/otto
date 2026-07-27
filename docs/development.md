# Development

[← Back to README](../README.md) · [Docs Index](./index.md)

For deeper workflows and package-specific details, see [Development Guide](development-guide.md).

## Prerequisites

- [Bun](https://bun.sh)
- platform tooling required by the app you are working on (for example Tauri/mobile toolchains)

## Setup

```bash
git clone https://github.com/nitishxyz/otto.git
cd otto
bun install
```

## Core commands

```bash
bun lint
bun test
bun run typecheck
bun run compile
```

## Useful app/package dev commands

```bash
bun run dev:cli
bun run --filter @ottocode/tui dev
bun run dev:web
bun run dev:desktop
bun run --filter @ottocode/server dev
bun run --filter @ottocode/sdk dev
```

## Local daemon workflow

Default CLI, TUI, web, and ask flows reuse one authenticated local daemon per user. Manual foreground serving remains available through `otto serve`.

Useful daemon commands:

```bash
bun run apps/cli/index.ts service status
bun run apps/cli/index.ts service start
bun run apps/cli/index.ts service restart
bun run apps/cli/index.ts service stop
bun run apps/cli/index.ts service password
```

Project commands:

```bash
bun run apps/cli/index.ts projects list
bun run apps/cli/index.ts projects open /path/to/project
bun run apps/cli/index.ts projects close <project-id>
bun run apps/cli/index.ts projects forget <project-id-or-path>
```

Daemon state is stored in the global otto state directory (for example `~/.local/state/otto/` on Linux/macOS):

- `server.json` registers the daemon URL/PID/version/id.
- `server-token` is the local auth secret and should have `0600` permissions.

When debugging daemon reuse, first run `service status`; stale registrations are removed automatically when authenticated health checks fail. Stop the daemon before rotating the token.

## SST / infra

Current `sst.config.ts` wires:

- `infra/script`
- `infra/landing`
- `infra/preview-api`
- `infra/preview-web`
- `infra/og`

Commands:

```bash
bun sst dev
bun sst deploy --stage prod
```

## Database workflow

```bash
bun run db:generate
bun run db:reset
```

For schema changes:

1. update schema files under `packages/database/src/schema/`
2. generate migrations with Drizzle
3. update `packages/database/src/runtime/migrations-bundled.ts`
4. test the migration locally

## API workflow

When changing server APIs:

1. update `packages/server/src/routes/`
2. update the route's Zod OpenAPI schemas registered with
   `zodOpenApiRoute(...)`
3. regenerate the client:

```bash
bun run --filter @ottocode/api generate
```

Project-aware routes should use `resolveRequestProject(c)` or `resolveRequestProjectRoot(c)` from `packages/server/src/routes/project-context.ts`. Do not add new route-level `process.cwd()` fallbacks; `tests/server-routes-cwd-guard.test.ts` enforces that the compatibility fallback stays centralized.

For first-party clients, include selected project context in all route calls and streams:

- preferred: `projectId=<id>` or `X-Otto-Project-Id`
- compatibility: `project=<absolute-path>` or `X-Otto-Project`

React Query keys and TUI hook dependencies should include the project id/key so sessions, messages, config, files, and git state do not cross projects.

## Runtime credential prompts

Shell and terminal tools detect common interactive prompts and forward the response directly to the waiting process. This includes sudo, SSH and git credentials, yes/no confirmations, named text fields, selections, defaults, and “press Enter” prompts. Session-scoped git push and pull requests run in a pseudo-terminal so remote password, passphrase, username, and host-confirmation prompts can be answered by the client.

Prompt detection is intentionally conservative because ordinary command output can also end in a question or colon. Full-screen, arrow-key, or raw-TTY interfaces should use the terminal tool, which provides an interactive pseudo-terminal; they cannot be represented by a single shell input modal.

The web prompt can remember secret values for 15 minutes. Remembered values are scoped to the project, command, and prompt, kept only in server process memory, and cleared on expiry or server restart. They are never written to project files, configuration, logs, or chat history.

## Build targets

```bash
bun run build:bin:darwin-arm64
bun run build:bin:darwin-x64
bun run build:bin:linux-x64
bun run build:bin:linux-arm64
```

## Repo conventions

- use Bun for everything
- use Biome via `bun lint`
- use workspace imports for cross-package references
- keep changes focused and modular
- write tests for behavior changes
