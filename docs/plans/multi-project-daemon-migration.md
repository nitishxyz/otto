# Multi-Project Daemon Migration Plan

## Goal

Move otto from "one local server per project directory" to "one local server per user that can open many projects".

The target design should:

- reduce startup time for CLI, TUI, web, and short-lived commands
- reduce duplicate Bun/server/MCP/runtime processes
- keep project sessions, files, tools, config, and terminals isolated
- preserve the existing local-first per-project storage layout
- support TUI, web UI, CLI commands, desktop, and future mobile/remote clients
- avoid broad rewrites of the session/message runner while the migration is in progress

## Implementation Status

Status: implemented through the planned migration tasks, with a few follow-up limitations documented below.

Completed in this repo:

- Phase 0: server-side `ProjectManager`, project routes, shared request project resolver, and tests for `?project=`/`?projectId=`.
- Phase 1: daemon registration/reuse service, local token auth, health/version checks, `otto service ...`, and default CLI/TUI/web/ask daemon startup.
- Phase 2: route cwd cleanup with a guard test; route-level `process.cwd()` fallback is centralized in `project-context.ts`, and CLI serve no longer mutates cwd during activation.
- Phase 3: TUI and web-sdk/web selected-project propagation, stream URL project context, and project-scoped cache keys.
- Phase 4: focused runtime scoping for event subscriptions, session queue abort controllers/events, approvals, secure input, and active shells.
- Phase 5: CLI `otto projects ...` commands, persisted known-project listing, web project switcher, and TUI project indicator.
- Phase 6 docs: architecture, development, API, troubleshooting, and this plan updated.

Known remaining limitations:

- MCP manager registry is still globally owned in the SDK and needs a broader project-scoped manager pass.
- Terminal managers are present on `ProjectRuntime`, but full terminal route ownership/filtering still needs a broader pass.
- Legacy `?project=` and `OTTO_SERVER_URL` compatibility remains intentionally supported.
- Requests with no project context still use the centralized compatibility fallback only.

## Non-Goals

- Do not merge all project SQLite databases into one global database in this migration.
- Do not move project runtime data back into repo-local `.otto/`.
- Do not require users to manually start a daemon before using `otto`.
- Do not make the server trust arbitrary network clients; localhost daemon reuse still needs local auth.
- Do not break the current `?project=/path` API compatibility in the first phase.

## Current State In This Repo

### Process model

Today the CLI starts an API server inside the current CLI process for most interactive flows.

Important files:

- `apps/cli/src/commands/serve.ts`
  - `activateProject(projectRoot)` calls `process.chdir(projectRoot)`.
  - `startApiServer()` starts a Bun server for the TUI path.
  - `handleServe()` starts the API server and optional embedded web UI.
- `apps/cli/src/cli.ts`
  - default `otto` starts a server, then starts `@ottocode/tui`.
  - some commands start an ephemeral server via `ensureServer()`.
- `apps/cli/src/ask/server.ts`
  - `startEphemeralServer()` starts an in-process Bun server on port `0`.
  - `OTTO_SERVER_URL` can point commands at an existing server, but discovery/reuse is manual.

Problem: a process has one mutable cwd. `process.chdir(projectRoot)` makes the server fundamentally single-project even though many routes accept a project query parameter.

### Project addressing

Many server routes already accept a project path override:

```ts
const projectRoot = c.req.query('project') || process.cwd();
```

This pattern appears across sessions, config, tools, files, git, attachments, goals, MCP, skills, doctor, and usage routes. A search currently finds roughly 90 direct `process.cwd()` usages under `packages/server/src`.

Representative files:

- `packages/server/src/routes/sessions/crud/create.ts`
- `packages/server/src/routes/ask.ts`
- `packages/server/src/routes/files/handlers.ts`
- `packages/server/src/routes/git/status.ts`
- `packages/server/src/routes/config/main.ts`
- `packages/server/src/routes/mcp/service/lifecycle.ts`

Problem: route-level project selection is ad hoc. Some routes use `?project`, some ignore it, and client packages often do not send it.

### Client behavior

TUI and web mostly rely on the server cwd today.

- `apps/tui/src/hooks/useSession.ts`
  - calls `listSessions`, `createSession`, `createMessage`, etc. without project query parameters.
- `apps/tui/src/hooks/useStream.ts`
  - parses a `project` query param from stream URLs, but `buildSessionStreamUrl({ baseUrl, sessionId })` is called without project.
- `packages/web-sdk/src/lib/api-client/sessions.ts`
  - session APIs call generated SDK methods without project query parameters.
- `packages/web-sdk/src/lib/api-client/utils.ts`
  - configures only `baseURL`; there is no selected-project request context.

Problem: even after the server becomes multi-project capable, clients need an explicit selected project and must include it in API calls, query cache keys, and streams.

### Storage model

This part is already aligned with a multi-project daemon.

- `packages/sdk/src/config/src/index.ts`
  - `loadConfig(projectRoot)` resolves project config and project state paths.
- `packages/sdk/src/config/src/paths.ts`
  - provides `getProjectId`, `getProjectStateDir`, `getProjectDbPath`, attachments, debug, logs, tmp, and cache dirs.
- `packages/database/src/index.ts`
  - caches DB handles by `dbPath`.
  - migrations are applied per DB path.
- `packages/server/src/runtime/projects/registry.ts`
  - tracks known projects in global user config/state.
  - discovers existing per-project state dirs with `project.json` and `otto.sqlite`.

This means one process can safely open multiple project DBs as long as every request resolves the correct project root before calling `loadConfig()` / `getDb()`.

### Session metadata

The sessions table includes `project_path`:

- `packages/database/src/schema/sessions.ts`

This helps display and audit the original project path. It does not replace request-scoped project routing, because sessions are stored in per-project DBs and a session ID alone cannot tell the server which DB to open.

### Runtime singletons and process-global state

Several runtime pieces are currently process-global or keyed only by session/message IDs.

Important examples:

- `packages/server/src/index.ts`
  - `globalTerminalManager = new TerminalManager()` is shared by all routes.
- `packages/sdk/src/core/src/mcp/lifecycle.ts`
  - `globalMCPManager` is a single global manager.
  - `initializeMCP()` stops the previous manager before creating a new one.
- `packages/server/src/events/bus.ts`
  - event subscribers are keyed by `sessionId` only.
- `packages/server/src/runtime/session/queue/state.ts`
  - `runners` is keyed by `sessionId` only.
  - abort controllers are keyed by `messageId` only.
- `packages/server/src/runtime/tools/approval.ts`
  - pending approvals are global and store `sessionId`.
- `packages/server/src/runtime/tools/secure-input.ts`
  - pending secure input is global and stores `sessionId`.
- `packages/server/src/runtime/tools/active-shells.ts`
  - active shells are global and store `sessionId` / `messageId`.

Problem: UUID collisions are unlikely, but a multi-project daemon should not rely on global IDs when the server must route DB reads, stream subscriptions, approvals, terminal actions, and MCP state to the right project.

## OpenCode Comparison

A fresh pull of `tmp/opencode` shows they are already using a daemon-style model.

### Daemon registration and reuse

Relevant file:

- `tmp/opencode/packages/cli/src/services/daemon.ts`

Observed behavior:

- stores registration at global user state `server.json`
- stores a local password in a separate `password` file with `0600` permissions
- checks server health before reuse
- checks server version compatibility before reuse
- starts a detached `serve --register` process when needed
- writes `{ id, version, url, pid }` atomically through a temp file + rename
- authenticates before signaling a registered PID, reducing PID-reuse risk
- removes stale registration if health fails

Useful patterns for otto:

- use a stable local secret instead of trusting localhost alone
- keep daemon registration in user state, not per project
- use health + version checks before reusing the daemon
- only kill a registered PID after authenticating the server
- avoid passing credentials on process args or env when possible

### Request-scoped location/project context

Relevant files:

- `tmp/opencode/packages/server/src/location.ts`
- `tmp/opencode/packages/server/src/middleware/session-location.ts`
- `tmp/opencode/packages/core/src/location-services.ts`
- `tmp/opencode/packages/core/src/location.ts`
- `tmp/opencode/packages/core/src/project.ts`

Observed behavior:

- requests carry a location through query params or headers:
  - `location[directory]`
  - `location[workspace]`
  - `x-opencode-directory`
  - `x-opencode-workspace`
- server middleware turns that into a `Location.Ref`
- session-scoped routes can recover location from the session row
- project/location services are cached by location with an idle TTL
- project resolution canonicalizes the git worktree and computes a stable project ID

Useful patterns for otto:

- centralize project resolution in middleware/helper code, not in each handler
- support both explicit directory and stable project/workspace IDs
- cache per-project services with idle cleanup
- for session routes, allow resolving project from session metadata only when there is a global index or central DB; otherwise keep explicit project context required

### Important difference

OpenCode currently uses a global database path for many server/session tables. Otto already has per-project SQLite databases. We should not copy OpenCode's storage model directly.

For otto, the right adaptation is:

- copy the daemon registration/auth pattern
- copy the request-scoped location/project-service pattern
- keep otto's per-project state directories and DBs

## Target Architecture

### One daemon per user

Add a background daemon that all local clients reuse.

Proposed global files:

```txt
<global-state-or-config>/otto/
  server.json
  server-token
```

`server.json` should contain:

```json
{
  "id": "random-uuid",
  "version": "<otto version>",
  "url": "http://127.0.0.1:<port>",
  "pid": 12345,
  "startedAt": 1780000000000
}
```

`server-token` should be random, local-only, and written with restrictive permissions.

Daemon rules:

- bind to `127.0.0.1` by default
- support `--network` only for explicit `otto serve --network` style flows
- require auth for all daemon API requests, even on localhost
- reuse daemon only when health check passes and version matches
- atomically write registration through temp file + rename
- before stopping, authenticate the registered server, then signal the PID
- if registration is stale, remove it and start a new daemon

### ProjectManager

Add a server-side project manager. Suggested path:

```txt
packages/server/src/runtime/projects/manager.ts
```

Core types:

```ts
export interface ProjectRef {
  id: string;
  root: string;
}

export interface ProjectRuntime {
  id: string;
  name: string;
  root: string;
  cfg: OttoConfig;
  db: DB;
  terminalManager: TerminalManager;
  lastUsedAt: number;
  stopIdleResources(): Promise<void>;
}
```

Core methods:

```ts
openProject(input: { path: string }): Promise<ProjectRuntime>;
getProject(input: { id?: string; path?: string }): Promise<ProjectRuntime>;
listOpenProjects(): ProjectRuntimeSummary[];
closeProject(id: string): Promise<void>;
touchProject(id: string): void;
```

Responsibilities:

- canonicalize paths with `realpath`, preserving a fallback for non-existent paths only where routes explicitly allow creation
- call `loadConfig(projectRoot)`
- call `getDb(cfg.projectRoot)` to initialize/migrate the DB
- call existing `touchProject(cfg.projectRoot, cfg.paths.dbPath)`
- cache `ProjectRuntime` objects by project ID and root path
- enforce idle cleanup for terminal/MCP/watch resources
- expose a compatibility default project only for legacy callers

### ProjectRuntime boundaries

Project-scoped:

- config and `.otto/config.json` overlays
- per-project DB handle
- terminal manager or terminal namespace
- MCP manager/lifecycle
- file search/read roots
- git route roots
- session queues and abort controllers
- approvals and secure input prompts
- event streams and client event filters
- subagent runtime state
- tools contributed by project plugins and project skills

Global/user-scoped:

- daemon process registration
- local daemon auth token
- provider OAuth credentials and secure auth storage
- global provider config
- global plugin registry/cache
- global model catalog/cache
- usage aggregation across known projects

### Request project context

Add one shared resolver instead of repeating `c.req.query('project') || process.cwd()`.

Suggested path:

```txt
packages/server/src/routes/project-context.ts
```

Supported inputs during migration:

1. `projectId` query param
2. `project` query param as absolute path
3. `X-Otto-Project-Id` header
4. `X-Otto-Project` header as absolute path
5. compatibility default project, only if the server was launched with one

Return type:

```ts
export interface RequestProjectContext {
  projectId: string;
  projectRoot: string;
  cfg: OttoConfig;
  db: DB;
  runtime: ProjectRuntime;
}
```

Rules:

- new internal code should call the resolver once at route entry
- do not call `process.cwd()` in route handlers
- do not call `loadConfig()` directly from route handlers unless the project context helper does it
- all OpenAPI query schemas should reuse a shared project query schema
- route handlers should pass `ctx.projectRoot`, `ctx.cfg`, and `ctx.db` downward

### Project routes

Add documented API routes:

```txt
GET    /v1/projects
POST   /v1/projects/open
GET    /v1/projects/{projectId}
DELETE /v1/projects/{projectId}/close
POST   /v1/projects/{projectId}/touch
```

`POST /v1/projects/open` body:

```json
{
  "path": "/absolute/project/path"
}
```

Response:

```json
{
  "id": "agi-a13f92c0",
  "name": "agi",
  "path": "/Users/bat/dev/nitishxyz/agi",
  "stateDir": "...",
  "dbPath": "...",
  "openedAt": 1780000000000,
  "lastUsedAt": 1780000000000
}
```

`GET /v1/projects` should return both:

- open projects from the current daemon process
- known projects from the persisted registry

Use a field such as `open: boolean` to distinguish them.

### API shape migration

Keep existing `?project=<absolute path>` for backwards compatibility.

Preferred new style:

```txt
GET /v1/sessions?projectId=<id>
POST /v1/sessions?projectId=<id>
GET /v1/sessions/{id}/stream?projectId=<id>
```

Longer-term optional style:

```txt
GET /v1/projects/{projectId}/sessions
POST /v1/projects/{projectId}/sessions
GET /v1/projects/{projectId}/sessions/{sessionId}/stream
```

Recommendation: first add `projectId` query/header support everywhere. Path-nested project routes can come later if needed.

## Migration Phases

### Phase 0: Stabilize project context helpers

Deliverables:

- Add `ProjectManager` skeleton and tests.
- Add shared project query schema/helper.
- Add `resolveRequestProject(c)` helper.
- Add route tests proving both `?project=` and `?projectId=` resolve the same project.

Implementation notes:

- Do not change CLI process model yet.
- Keep `process.cwd()` fallback only inside the resolver and mark it compatibility-only.
- Start using the resolver in new/changed routes.

Acceptance criteria:

- `bun test tests/project-registry.test.ts` still passes.
- New tests can open two temp projects in one process and get distinct `ProjectRuntime` instances.

### Phase 1: Add daemon registration and reuse

Deliverables:

- Add daemon service in `apps/cli/src` or `packages/sdk/src` for shared use.
- Add `otto service start|stop|status|restart|password` or equivalent command group.
- Update `apps/cli/src/ask/server.ts` to discover/reuse the daemon instead of always starting an in-process ephemeral server.
- Update default `otto` TUI flow to reuse the daemon.
- Keep `otto serve` available for foreground/manual serving.

Suggested flow:

1. CLI resolves current project path.
2. CLI ensures daemon is healthy or starts it detached.
3. CLI calls `POST /v1/projects/open` with the current project path.
4. CLI starts TUI/web with `{ baseUrl, authHeaders, projectId, projectRoot }`.

Acceptance criteria:

- Running `otto` in two different directories reuses one daemon process.
- `otto service status` reports the shared daemon.
- Killing stale registered PIDs is safe and requires successful auth first.
- Version mismatch starts/replaces the daemon.

### Phase 2: Remove server cwd dependence

Deliverables:

- Remove `process.chdir(projectRoot)` from `apps/cli/src/commands/serve.ts` startup paths.
- Replace direct server route fallbacks with `resolveRequestProject(c)`.
- Add lint/test guard that prevents new `process.cwd()` usages under `packages/server/src/routes` except in the central resolver.
- Make `createStandaloneApp` / `createEmbeddedApp` optionally accept an initial/default project root.

High-priority route groups:

- sessions CRUD and queue
- messages and stream
- ask
- files and attachments
- git
- config/providers/models/tools/agents
- MCP lifecycle/config/auth
- skills and recipes
- goals/subagents/otto

Acceptance criteria:

- A daemon launched from directory A can serve requests for directory B without changing process cwd.
- Requests without any project context still work only through an explicit compatibility default.
- Tests cover two projects with different config defaults and distinct session lists.

### Phase 3: Update clients to carry selected project

Deliverables:

- TUI receives `projectId` and `projectRoot` from CLI startup.
- TUI includes project context in all generated SDK calls and stream URLs.
- Web UI receives initial project context from the web server injection or startup API call.
- `packages/web-sdk` gains a selected project store/context.
- React Query keys include project ID, e.g. `['sessions', projectId, 'list']`.
- Generated API client wrappers accept/pass `projectId` query values.

Files to update first:

- `apps/tui/src/api.ts`
- `apps/tui/src/hooks/useSession.ts`
- `apps/tui/src/hooks/useStream.ts`
- `apps/tui/src/hooks/useConfig.ts`
- `packages/web-sdk/src/lib/api-client/sessions.ts`
- `packages/web-sdk/src/lib/api-client/files.ts`
- `packages/web-sdk/src/lib/api-client/git.ts`
- `packages/web-sdk/src/hooks/useSessions.ts`
- `packages/web-sdk/src/hooks/useSessionStream.ts`

Acceptance criteria:

- One web UI can switch between projects without changing server process.
- TUI launched from project A does not show sessions from project B.
- Query cache invalidation does not cross project boundaries.
- SSE streams include project context.

### Phase 4: Scope runtime singletons by project

Deliverables:

- Replace `globalTerminalManager` with project-scoped terminal managers or a manager registry keyed by project ID.
- Replace global MCP manager with an MCP manager registry keyed by project ID.
- Key event bus subscriptions by `{ projectId, sessionId }`.
- Key session queues by `{ projectId, sessionId }`.
- Key abort controllers by `{ projectId, messageId }` or by a composite run ID.
- Key approvals and secure inputs by project/session.
- Ensure cleanup when a project is closed or idle.

MCP is the highest-risk item:

- `packages/sdk/src/core/src/mcp/lifecycle.ts` currently has `globalMCPManager`.
- `initializeMCP()` currently stops the old manager.
- Multi-project daemon requires either:
  - `getMCPManager(projectId)` / `initializeMCP(projectId, ...)`, or
  - moving MCP manager ownership into `ProjectRuntime` and avoiding the SDK global.

Terminal considerations:

- Existing terminal IDs are globally random, but terminal lists should be project-filtered.
- Terminal creation should default cwd to the request project root, not server cwd.
- A global hard cap can remain, but per-project caps are safer for UX.

Acceptance criteria:

- Starting MCP server `foo` in project A does not stop project B's MCP servers.
- Listing terminals in project A does not show project B terminals unless explicitly using an all-project admin endpoint.
- Aborting a session in project A cannot affect active shells in project B.
- Closing a project kills or detaches only that project's runtime resources.

### Phase 5: Project switcher UX

Deliverables:

- Add project list/switcher in web UI.
- Add project indicator in TUI header/status area.
- Add CLI commands:
  - `otto projects list`
  - `otto projects open <path>`
  - `otto projects close <id>`
  - `otto projects forget <id-or-path>`
- Add recent projects from the existing registry.
- Make `otto web` open the daemon web UI with the current project selected.

Acceptance criteria:

- Users can open multiple projects from one browser session.
- Recently opened projects are available after daemon restart.
- Closing a project makes it disappear from open projects but not necessarily from known projects.

### Phase 6: Cleanup and compatibility removal

Deliverables:

- Remove route-level `process.cwd()` fallbacks after clients are migrated.
- Keep `?project=` path support for external clients, but internally prefer project ID.
- Document daemon lifecycle and troubleshooting.
- Update `docs/architecture.md`, `docs/development.md`, and API docs.
- Add a migration note for users/scripts relying on one server per directory.

Acceptance criteria:

- No direct `process.cwd()` under server routes except approved compatibility helpers.
- Default CLI/TUI/web flows use daemon + project open.
- `OTTO_SERVER_URL` remains supported but now requires/project-selects through headers/query.

## Detailed Implementation Notes

### Daemon service location

Recommended first implementation location:

```txt
apps/cli/src/daemon.ts
```

If desktop/mobile need the same logic later, move the reusable parts into `@ottocode/sdk`.

Functions:

```ts
readRegistration(): Promise<DaemonRegistration | null>;
writeRegistration(reg: DaemonRegistration): Promise<void>;
getOrCreateToken(): Promise<string>;
healthCheck(reg: DaemonRegistration, token: string): Promise<boolean>;
ensureDaemon(opts: { version: string }): Promise<DaemonConnection>;
stopDaemon(): Promise<void>;
```

Use `Bun.spawn` or `node:child_process.spawn` detached, with stdio ignored, mirroring OpenCode's approach.

### Auth header

Use a simple local bearer-style header initially:

```txt
Authorization: Bearer <server-token>
```

or an otto-specific header:

```txt
X-Otto-Server-Token: <server-token>
```

The server should allow unauthenticated only for explicitly public endpoints if any. For local daemon routes, default to requiring the token.

### Health route

Add or extend a health route:

```txt
GET /v1/health
```

Response:

```json
{
  "ok": true,
  "version": "x.y.z",
  "pid": 12345,
  "daemonId": "uuid"
}
```

The daemon client should reject mismatched version or daemon ID registration conflicts.

### Backward compatibility default project

During migration the daemon may have a compatibility default project:

```ts
createStandaloneApp({ defaultProjectRoot })
```

Rules:

- default project is only used when a request has no project context
- default project is set at daemon startup or first CLI open
- no route should mutate global cwd to change the default
- logs should warn when compatibility fallback is used, to reveal missing client project propagation

### Project ID versus path

Use project ID internally where possible, but always store canonical root on the server side.

Reasons:

- paths can be long and awkward in browser URLs
- paths can contain characters that need encoding
- project IDs are stable display/switch keys
- server can still verify a project ID maps to a known root before using it

Path support remains important for first open and scripts:

```txt
POST /v1/projects/open { "path": "/repo" }
GET /v1/sessions?project=/repo
```

### Session route project recovery

Because otto currently stores sessions in per-project DBs, a route like this is ambiguous without project context:

```txt
GET /v1/sessions/{sessionId}
```

Options:

1. Require project context for all session routes.
2. Maintain a global session index mapping `sessionId -> projectId`.
3. Fan out across open/known project DBs when project is omitted.

Recommendation:

- Phase 1-4: require project context from first-party clients; compatibility fallback uses default project only.
- Later: add a small global session index if deep links without project context are important.

Do not fan out on every session route by default; it can be slow and surprising.

### Event bus keys

Introduce helpers:

```ts
function eventScope(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}
```

Then update:

- publish
- subscribe
- queue events
- message events
- approval events
- client notifications where relevant

Client event streams may need optional project filters so a web UI can receive all open-project notifications while a TUI receives only its selected project.

### Runtime idle cleanup

Project runtime should record `lastUsedAt` on each resolved request.

Suggested defaults:

- keep DB handles open for process lifetime unless explicit close is requested
- stop idle MCP servers after 60 minutes with no project activity
- clean exited terminals after existing terminal cleanup delay
- prevent project close while active runs are executing unless forced

Close API behavior:

```txt
DELETE /v1/projects/{projectId}/close?force=false
```

- `force=false`: fail if active runs/terminals/MCP processes exist
- `force=true`: abort runs and stop project resources

## Test Plan

### Unit tests

- Project manager canonicalizes paths and dedupes symlinks/relative paths.
- Project manager opens two temp projects and returns distinct configs/DBs.
- Daemon registration handles stale `server.json`.
- Daemon registration rejects version mismatch.
- Token file is created with restrictive permissions where the platform supports it.
- Request project resolver handles `project`, `projectId`, and headers.
- Request project resolver warns/falls back only when compatibility default exists.

### Route tests

- Create sessions in project A and project B through one app instance.
- List sessions for project A does not include project B.
- Config defaults differ by project when each has a different `.otto/config.json`.
- File search/read stays inside the selected project.
- Git status uses selected project root.
- Session stream receives only events for the selected project/session scope.
- Abort route only aborts runs for the selected project.

### Client tests

- TUI hook calls include project query/header.
- Web SDK query keys include project ID.
- Web SDK session stream URL includes project context.
- Project switch invalidates/refetches project-scoped data.

### Integration tests

- Start daemon, open project A, create session.
- From another cwd, reuse same daemon, open project B, create session.
- Verify one server process is running.
- Verify each project has its own SQLite DB and sessions.
- Restart daemon and verify recent projects are listed from registry.

### Manual verification

```sh
bun test tests/project-registry.test.ts
bun test tests/server-standalone.test.ts
bun test tests/sessions-agent.test.ts
bun test tests/git-routes.test.ts
bun test tests/project-daemon.test.ts
bun lint
```

Add the new test file names as implementation lands.

## Risks And Mitigations

### Risk: hidden process cwd dependencies

Mitigation:

- add a lint/test search for `process.cwd()` under server routes
- centralize compatibility fallback in one helper
- remove `process.chdir()` from server startup early

### Risk: MCP global manager stops another project's servers

Mitigation:

- prioritize MCP registry refactor before enabling multi-project MCP in UI
- temporarily mark MCP routes as default-project-only if needed
- add tests proving project A/B MCP lifecycle isolation

### Risk: clients forget project context

Mitigation:

- server logs compatibility fallback use
- generated API wrapper requires project context in first-party hooks
- query keys include project ID so missing context shows up in tests

### Risk: daemon auth surprises embedded/network users

Mitigation:

- local daemon auth is default
- explicit `otto serve --network` can expose separate auth/CORS behavior
- document `OTTO_SERVER_URL` plus token/header requirements

### Risk: stale daemon registrations and PID reuse

Mitigation:

- copy OpenCode's health-before-kill pattern
- registration includes daemon ID and version
- only signal PID after authenticated health check confirms same daemon

### Risk: active resources on project close

Mitigation:

- default close refuses if active runs/terminals exist
- force close is explicit and aborts resources in a scoped way
- idle cleanup logs what it stops

## Suggested First PR Sequence

1. Add `ProjectManager`, request project resolver, and project routes behind existing server process.
2. Convert sessions + ask routes to the resolver and add two-project tests.
3. Add daemon registration/reuse and service commands.
4. Update TUI startup and TUI session/message/stream APIs to carry project context.
5. Update web-sdk session/config/file/git APIs and query keys.
6. Refactor MCP manager to project-scoped registry.
7. Refactor terminal manager and queue/event scopes.
8. Remove `process.chdir()` and direct route cwd fallbacks.
9. Add project switcher UX.
10. Update architecture/development docs.

## Open Questions

- Should daemon auth use `Authorization: Bearer` or an `X-Otto-Server-Token` header?
- Should project IDs remain the current `getProjectId(projectRoot)` format, or should we expose a shorter display ID separately?
- Should `otto serve` become the daemon foreground command, or should daemon commands live under `otto service` and `serve` stay manual/isolated?
- Do we want a global session index for deep links without project context?
- Should terminal IDs be globally unique across projects or prefixed with project ID for easier debugging?

## Recommendation

Implement this as a staged migration, not a rewrite.

The best path is:

1. daemon registration/reuse for process reduction
2. explicit request project context for correctness
3. client-side selected project propagation
4. project-scoped runtime state for isolation

Otto already has the right per-project storage foundation. The main work is removing cwd as implicit server state and replacing process-global runtime objects with project-scoped managers.
