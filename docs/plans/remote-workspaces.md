# Remote Workspaces & Launcher Merge

## Problem

Today, otto has three separate ways to run workspaces:

1. **Desktop app** (`apps/desktop`) — spawns a CLI sidecar locally, iframes the web UI
2. **Launcher app** (`apps/launcher`) — manages Docker containers, opens web UI in browser
3. **CLI** (`otto serve`) — always starts both API server + web server together

These are disconnected. The desktop app can't connect to a Docker container managed by the launcher. The launcher can't embed its workspaces inside the desktop app. There's no way to point any client at a remote API server without building it yourself.

## Goal

1. **`otto web` CLI command** — start only the web UI server, pointed at any API URL
2. **Desktop "Connect to URL"** — open a remote workspace inside the desktop app
3. **Merge launcher into desktop** — one app for local + Docker + remote workspaces

---

## Current Architecture (What Exists Today)

### CLI: `otto serve` (`apps/cli/src/commands/serve.ts`)

Always starts both servers as a tightly coupled pair:

```
otto serve
  ├── API server (Hono)       → localhost:{port}      (sdk, database, tools, agents)
  └── Web server (static SPA) → localhost:{port+1}    (serves @ottocode/web-ui assets)
```

The web server (`apps/cli/src/web-server.ts`) is a static file server that:
- Serves the pre-built `@ottocode/web-ui` assets (compiled from `apps/web`)
- Injects `<script>window.OTTO_SERVER_URL = 'http://localhost:{apiPort}';</script>` into `index.html`
- Has zero logic beyond serving files and injecting that one variable

### Desktop app (`apps/desktop`)

```
App.tsx
  ├── ProjectPicker — "Open Project" or "Clone from GitHub"
  └── Workspace
        ├── useServer() → tauriBridge.startServer(projectPath)
        │     └── Rust: spawns `otto serve --port {port} --no-open` as a child process
        ├── Waits for API server health check
        └── Renders <iframe src="http://localhost:{webPort}">
```

Key types:
```ts
// apps/desktop/src/lib/tauri-bridge.ts
interface Project {
  path: string;         // local filesystem path
  name: string;
  lastOpened: string;
  pinned: boolean;
}

interface ServerInfo {
  pid: number;          // child process PID
  port: number;         // API server port
  webPort: number;      // Web UI port (port + 1)
  url: string;          // http://localhost:{webPort}
  projectPath: string;
}
```

The desktop spawns the CLI binary as a sidecar. Each window = one project = one sidecar process. `createNewWindow()` opens a new Tauri window with its own ProjectPicker.

**Rust backend** (`apps/desktop/src-tauri/src/commands/`):
- `server.rs` — `start_server`, `stop_server`, `stop_all_servers`, `list_servers`
- `project.rs` — recent projects CRUD, pinning
- `github.rs` — GitHub device code OAuth, user info, repo listing
- `git.rs` — clone, status, commit, push, pull
- `window.rs` — `create_new_window`
- `onboarding.rs` — first-run setup (wallet gen, provider config)
- `updater.rs` — auto-update

### Launcher app (`apps/launcher`)

Completely separate Tauri app for Docker-based team workspaces.

```
App.tsx
  ├── Welcome — list teams, create team, import .otto file
  ├── TeamSetup — generate deploy key, encrypt with password
  ├── ProjectList — list repos for a team
  ├── AddProject — add git repo, pick SSH mode (team key / personal)
  ├── ImportDialog — import .otto config file
  ├── PasswordPrompt — decrypt team deploy key
  └── SetupProgress — create container, poll logs, show steps, "Open" button
```

**Rust backend** (`apps/launcher/src-tauri/src/commands/`):
- `docker.rs` (693 lines) — full Docker Engine API client via Unix socket / Windows TCP
  - `docker_available`, `image_exists`, `image_pull`
  - `container_create`, `container_start`, `container_stop`, `container_remove`
  - `container_logs`, `container_exec`, `container_inspect`
  - `container_restart_otto`, `container_update_otto`
  - Container creation builds an entrypoint script that: installs packages, sets up SSH, clones repo, installs otto, runs `otto serve --network`
- `crypto.rs` (198 lines) — Ed25519 key generation, AES-256-CBC encryption/decryption
  - `generate_deploy_key`, `encrypt_key`, `decrypt_key`, `verify_password`
  - `list_ssh_keys`, `get_host_git_config`
- `config.rs` (157 lines) — persists launcher state to `~/.config/otto-launcher/state.json`
  - `load_state`, `save_state`, `parse_team_config`, `export_team_config`, `save_otto_file`
- `ports.rs` (42 lines) — `find_available_port` for Docker port allocation

**How "Open" works in the launcher:**
The container runs `otto serve --network --port {apiPort}`, which starts both API + web server inside the container. Ports are forwarded (apiPort and apiPort+1). The "Open" button calls `openUrl(http://localhost:{webPort})` — opens the system browser pointing at the container's web server.

### Web SDK: How server URL is resolved (`packages/web-sdk`)

Multiple places independently read `window.OTTO_SERVER_URL`:
- `packages/web-sdk/src/lib/config.ts` — `computeApiBaseUrl()`, exports `API_BASE_URL`
- `packages/web-sdk/src/lib/api-client.ts` — `configureApiClient()`, `ApiClient.baseUrl` getter
- `packages/web-sdk/src/hooks/useWorkingDirectory.ts` — reads `window.OTTO_SERVER_URL` directly
- `packages/web-sdk/src/hooks/useResearch.ts` — reads `window.OTTO_SERVER_URL` directly

All fall back to `http://localhost:9100` if not set.

---

## Phase 1: `otto web` CLI Command

### What

A new CLI command that starts **only** the web UI server, pointed at an arbitrary API URL:

```bash
otto web --url http://localhost:9100          # local API server
otto web --url http://192.168.1.50:9100       # remote machine
otto web --url http://localhost:29000         # Docker container
otto web --url https://team.otto.dev:9100     # remote team server
```

### Why

- The web UI is a dumb shell — it just needs an API URL to iframe/connect to
- Docker containers already run their own API server inside; you just need the web UI locally
- Remote/team servers are the same — API is running somewhere, you need a local UI
- Separating `web` from `serve` makes the architecture honest about what the web server actually does

### Implementation

**New file: `apps/cli/src/commands/web.ts`**

```ts
import type { Command } from 'commander';
import { logger, openAuthUrl } from '@ottocode/sdk';
import { createWebServer } from '../web-server.ts';
import { colors } from '../ui.ts';

export interface WebOptions {
  api: string;
  port?: number;
  network: boolean;
  noOpen: boolean;
}

export async function handleWeb(opts: WebOptions, version: string) {
  // Validate API URL
  let apiUrl: URL;
  try {
    apiUrl = new URL(opts.api);
  } catch {
    console.error(`Invalid API URL: ${opts.api}`);
    process.exit(1);
  }

  // Optionally health-check the API server
  try {
    await fetch(opts.api, { method: 'GET', signal: AbortSignal.timeout(3000) });
  } catch {
    console.log(colors.yellow(`  ⚠ API server at ${opts.api} is not responding`));
    console.log(colors.dim('    Starting web UI anyway — it will retry when the server comes up'));
  }

  // Determine API port from URL for createWebServer compatibility
  const apiPort = parseInt(apiUrl.port || '9100', 10);
  const webPort = opts.port ?? 0;

  // createWebServer needs the API port to inject OTTO_SERVER_URL
  // For remote URLs, we need to modify createWebServer to accept a full URL
  const { port: actualWebPort, server } = createWebServer(
    webPort,
    apiPort,          // This will need to be the full URL instead
    opts.network,
  );

  const displayHost = opts.network ? getLocalIP() : 'localhost';
  const webUrl = `http://${displayHost}:${actualWebPort}`;

  console.log('');
  console.log(colors.bold('  ⚡ otto web') + colors.dim(` v${version}`));
  console.log('');
  console.log(`  ${colors.dim('Web UI')}  ${colors.cyan(webUrl)}`);
  console.log(`  ${colors.dim('API')}     ${colors.cyan(opts.api)}`);
  console.log('');
  console.log(colors.dim('  Press Ctrl+C to stop'));
  console.log('');

  if (!opts.noOpen) {
    await openAuthUrl(webUrl);
  }

  // Graceful shutdown
  const shutdown = () => {
    server.stop(true);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await new Promise(() => {});
}

export function registerWebCommand(program: Command, version: string) {
  program
    .command('web')
    .description('Start Web UI only, connected to a remote API server')
    .option('--url <api-url>', 'Use an existing API server URL')
    .option('-p, --port <port>', 'Web UI port', (v) => parseInt(v, 10))
    .option('--network', 'Bind to 0.0.0.0 for network access', false)
    .option('--no-open', 'Do not open browser automatically')
    .action(async (opts) => {
      await handleWeb(
        {
          api: opts.api,
          port: opts.port,
          network: opts.network,
          noOpen: !opts.open,
        },
        version,
      );
    });
}
```

**Modify `apps/cli/src/web-server.ts`**: The `getServerUrl` function currently constructs URLs from `requestHost` and `agiServerPort`. It needs to also accept a full URL string for remote servers:

```ts
// Current:
const getServerUrl = (requestHost?: string) => {
  if (network && requestHost) {
    const hostname = requestHost.split(':')[0];
    return `http://${hostname}:${agiServerPort}`;
  }
  return `http://localhost:${agiServerPort}`;
};

// New: accept either a port number or a full URL
export function createWebServer(
  port: number,
  apiServerPortOrUrl: number | string,   // <-- changed
  network = false,
) {
  const getServerUrl = (requestHost?: string) => {
    if (typeof apiServerPortOrUrl === 'string') {
      return apiServerPortOrUrl;  // Full URL, use as-is
    }
    // Existing logic for port number
    if (network && requestHost) {
      const hostname = requestHost.split(':')[0];
      return `http://${hostname}:${apiServerPortOrUrl}`;
    }
    return `http://localhost:${apiServerPortOrUrl}`;
  };
  // ... rest unchanged
}
```

**Register in `apps/cli/src/commands/index.ts`** and `apps/cli/src/cli.ts`.

**Dependencies**: `otto web` only needs `@ottocode/sdk` (for `openAuthUrl`, `logger`) and the web-server module. It does NOT need `@ottocode/server` or `@ottocode/database`. This is significantly lighter than `otto serve`.

### Also add `--api-only` to `serve`

For completeness, allow starting just the API server without the web UI:

```bash
otto serve --api-only    # API server only, no web UI
```

This is a one-line change in `handleServe` — skip `createWebServer()` if `opts.apiOnly` is set.

---

## Phase 2: Desktop "Connect to URL"

### What

Add a "Connect to Server" option in the desktop app's ProjectPicker that lets users enter a URL and iframe it directly, without spawning a sidecar.

### Changes

**Extend `Project` type** (`apps/desktop/src/lib/tauri-bridge.ts`):

```ts
interface Project {
  path: string;
  name: string;
  lastOpened: string;
  pinned: boolean;
  remoteUrl?: string;    // NEW: if set, skip sidecar and iframe this URL directly
}
```

**Modify `Workspace.tsx`**: Two code paths based on whether `project.remoteUrl` exists:

```ts
// Current: always starts a local sidecar
useEffect(() => {
  startServer(project.path);
}, [project.path]);

const iframeSrc = `${server.url}?_t=${Date.now()}&_pid=${server.pid}&_project=...`;

// New: skip sidecar for remote projects
useEffect(() => {
  if (project.remoteUrl) return; // No sidecar needed
  startServer(project.path);
}, [project.path, project.remoteUrl]);

const iframeSrc = project.remoteUrl
  ? `${project.remoteUrl}?_t=${Date.now()}`   // Remote: direct URL
  : `${server.url}?_t=${Date.now()}&_pid=${server.pid}&_project=...`;  // Local: sidecar
```

The title bar shows the remote URL instead of a port number. The "back" button doesn't need to `stopServer()` for remote projects.

**Add "Connect to Server" card in ProjectPicker**:

A third card alongside "Open Project" and "Clone from GitHub":

```
[📁 Open Project]  [🐙 Clone from GitHub]  [🔗 Connect to Server]
```

Clicking it opens a small modal/inline form:
- URL input field
- Name input field (auto-derived from URL hostname)
- "Connect" button

On submit, creates a `Project` with `remoteUrl` set and calls `onSelectProject()`.

**Persist remote projects**: They go into the same recent projects list and show with a different icon (🔗 vs 📁) to distinguish local from remote.

**No Rust changes needed**: The `Project` type is just JSON — Rust `save_recent_project` / `get_recent_projects` handle it via serde and will pass through the new `remoteUrl` field without changes (it's optional, so existing projects without it still work).

---

## Phase 3: Merge Launcher into Desktop

### What

Bring Docker workspace management into the desktop app. Replace the separate launcher app entirely.

### Scope of Changes

#### Rust Backend

Copy from `apps/launcher/src-tauri/src/commands/` into `apps/desktop/src-tauri/src/commands/`:

| File | Size | What it does |
|------|------|-------------|
| `docker.rs` | 693 lines | Full Docker Engine API client (Unix socket + Windows TCP). Container lifecycle management. |
| `crypto.rs` | 198 lines | Ed25519 deploy key generation. AES-256-CBC key encryption/decryption. SSH key listing. |
| `config.rs` | 157 lines | Launcher state persistence (`~/.config/otto-launcher/state.json`). Team config import/export. |
| `ports.rs` | 42 lines | Port allocation for Docker containers. |

Register all new commands in `apps/desktop/src-tauri/src/lib.rs`'s `invoke_handler!`.

**Cargo.toml additions** (from launcher's `Cargo.toml`):
```toml
# Docker API client
hyper = { version = "1", features = ["full"] }
hyper-util = { version = "0.1", features = ["client-legacy", "tokio"] }
http-body-util = "0.1"
tower = "0.5"

# Crypto
aes = "0.8"
cbc = "0.1"
pbkdf2 = "0.12"
sha2 = "0.10"
ssh-key = { version = "0.6", features = ["ed25519", "rand_core"] }
rand = "0.8"
base64 = "0.22"
```

#### React Frontend

Move launcher components into desktop app:

| Component | What it does | Integration point |
|-----------|-------------|-------------------|
| `TeamSetup.tsx` | Team creation flow (name, deploy key, password) | New section in ProjectPicker |
| `AddProject.tsx` | Add git repo to team (SSH mode, port config) | Modal from Docker workspace list |
| `ProjectCard.tsx` | Container status, start/stop/open/manage | Docker workspace list items |
| `ProjectList.tsx` | List containers for a team | New view in desktop app |
| `ImportDialog.tsx` | Import `.otto` config file | Drag-drop or file picker |
| `PasswordPrompt.tsx` | Decrypt team deploy key | Modal before container setup |
| `SetupProgress.tsx` | Container creation progress (image pull, SSH, git clone, otto start) | Full-screen view during setup |
| `Welcome.tsx` | Team list, create/import | Integrated into ProjectPicker |

Also move:
- `store.ts` → Adapt into a zustand store within desktop app (or merge into existing state)
- `lib/tauri.ts` → Merge into `lib/tauri-bridge.ts`
- `lib/ports.ts` → Copy as-is

#### Desktop App Flow (After Merge)

```
App.tsx
  ├── ProjectPicker (expanded)
  │     ├── 📁 Open Local Project        (existing)
  │     ├── 🐙 Clone from GitHub          (existing)
  │     ├── 🔗 Connect to Server          (Phase 2)
  │     ├── 🐳 Docker Workspaces          (from launcher)
  │     │     ├── Team list
  │     │     ├── Create team
  │     │     ├── Import .otto file
  │     │     └── Container list per team
  │     │           ├── Start / Stop / Open / Manage
  │     │           └── Add repo
  │     └── Recent projects (all types mixed)
  │
  └── Workspace (handles all three source types)
        ├── Local project → startServer(path) → iframe sidecar web UI
        ├── Remote URL → iframe remoteUrl directly
        └── Docker container → iframe http://localhost:{container.webPort}
```

#### Docker Workspace as a `Project`

A Docker container workspace becomes a `Project` with `remoteUrl` pointing at the container's web port:

```ts
// When user clicks "Open" on a running container:
const project: Project = {
  path: `/docker/${container.containerName}`,
  name: repoName,
  lastOpened: new Date().toISOString(),
  pinned: false,
  remoteUrl: `http://localhost:${container.webPort}`,
};
onSelectProject(project);
// → Workspace iframes http://localhost:{webPort}, no sidecar spawned
```

This means Phase 2 (Connect to URL) is the foundation that Phase 3 builds on. Docker containers are just a special case of "remote URL that happens to be localhost".

#### Migration from Launcher

- Launcher state at `~/.config/otto-launcher/state.json` should be auto-imported on first run of the merged desktop app
- The launcher app (`apps/launcher`) can be deprecated/removed after the merge
- Users who have both apps installed get a one-time migration

---

## Phase 4: Server Info Endpoint (Optional, Future)

Add `GET /v1/info` to `@ottocode/server`:

```json
{
  "name": "otto",
  "version": "0.x.y",
  "project": "/Users/dev/my-app",
  "uptime": 3600
}
```

Used by:
- Desktop app to show server metadata in the title bar
- Connection health checks
- Version compatibility checks between client and server

Not blocking for Phases 1-3.

---

## Phase 5: Auth Middleware (Future)

When remote servers need authentication:

```bash
otto serve --auth-token <token>     # Require token for API access
otto web --url https://... --token <token>  # Pass token to web UI
```

The web server can inject the token into `window.OTTO_AUTH_TOKEN`, and the web-sdk reads it alongside `OTTO_SERVER_URL` to add `Authorization` headers to API requests.

Not blocking for Phases 1-3.

---

## Implementation Order

| Phase | Effort | Depends On | Deliverable |
|-------|--------|-----------|-------------|
| **1a**: `otto web --url <api-url>` | Small (1 new file, 1 modified file) | Nothing | CLI can connect to any remote API |
| **1b**: `otto serve --api-only` | Tiny (3-line change) | Nothing | API server without web UI |
| **2**: Desktop "Connect to URL" | Small (extend Project type, modify Workspace) | Phase 1a (conceptually) | Desktop connects to remote servers |
| **3**: Merge launcher into desktop | Large (move Rust + React code) | Phase 2 | Single app for everything |
| **4**: `/v1/info` endpoint | Tiny | Nothing | Better metadata display |
| **5**: Auth middleware | Medium | Phase 1a | Secure remote access |

Phases 1a and 1b can be done independently in an afternoon. Phase 2 is a day. Phase 3 is the big one (a few days) but is mostly mechanical — moving code, not inventing new architecture.

---

## Key Design Decisions

1. **The web UI is always local** — it's never hosted remotely. The API server is the thing that can be local, remote, or containerized. The web server is just a delivery mechanism for static assets.

2. **`remoteUrl` on `Project`** — this one field unlocks everything. Local projects don't set it (sidecar is spawned). Remote/Docker projects set it (iframe directly). The Workspace component barely changes.

3. **No multi-server switching within a window** — each window/tab connects to one server. This matches how developers think (one project = one workspace) and avoids complex state management. The desktop's "New Window" button handles multiple simultaneous workspaces.

4. **Docker containers are just "remote URLs that happen to be localhost"** — the merged desktop app doesn't need a separate "Docker workspace" mode in the Workspace component. It manages containers in the ProjectPicker, and once a container is running, it's just a `remoteUrl`.

5. **`otto web` is ultra-lightweight** — it doesn't import `@ottocode/server` or `@ottocode/database`. It only needs the web-server module and `@ottocode/sdk` for `openAuthUrl`. This matters for the compiled binary if we ever want a separate lightweight "web-only" binary.
