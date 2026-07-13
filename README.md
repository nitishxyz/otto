<div align="center">

<img src="assets/brand/otto-lockup.svg" alt="otto" width="180" />

# otto

**A local-first AI coding platform.**

One runtime. Many surfaces. Your agents, your tools, your repo — on your machine.

[![Version](https://img.shields.io/badge/version-0.1.231-blue)](https://github.com/nitishxyz/otto)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Runtime](https://img.shields.io/badge/runtime-Bun-orange)](https://bun.sh)
[![AI SDK](https://img.shields.io/badge/AI%20SDK-v6-purple)](https://sdk.vercel.ai)

[Install](#install) · [Surfaces](#surfaces) · [Agents & Tools](#agents) · [Embedding](#embedding) · [Docs](docs/index.md)

</div>

---

## What is otto

otto is a local-first coding platform built around a single local runtime that gives AI models controlled access to your repo through built-in tools: file IO, search, patching, git, terminals, web fetch, skills, MCP, and task tracking.

You pick the surface. The runtime, agents, tools, sessions, and providers stay the same across all of them.

- **Local-first.** Your code, your machine, your keys. Secrets live in OS-secure stores, not config files.
- **Multi-provider.** Anthropic, OpenAI, Google, OpenRouter, OpenCode, OttoRouter, Kimi, Minimax, Z.AI — swap at runtime.
- **Extensible.** Custom tools, MCP servers, skills, and agent presets, per-project or global.
- **Open.** MIT-licensed, Bun monorepo, OpenAPI spec, embeddable server.

---

## Install

```bash
curl -fsSL https://install.ottocode.io | sh
```

Or via Bun:

```bash
bun install -g @ottocode/install
```

Then:

```bash
otto           # interactive TUI
otto web       # web UI in your browser
otto serve     # advanced foreground API/Web server
```

---

## Surfaces

otto ships in multiple forms. Pick whichever fits the moment — they all share the same runtime, sessions, and config.

| Surface | What it's for |
|---|---|
| **CLI** | One-shot prompts, scripts, CI, and terminal workflows |
| **TUI** | Full interactive session inside your terminal (default `otto`) |
| **Web UI** | Browser client for the local otto server |
| **Desktop** | Lightweight Tauri wrapper around the web UI |
| **Canvas** | Native tiled workspace — terminals, browsers, agents, side-by-side |
| **Server** | Embeddable Hono-based API you host in your own app |
| **SDK** | Auth, config, providers, tools, prompts, API client as packages |
| **ACP adapter** | Integrate otto with ACP-capable editors and tools |

### CLI

```bash
otto                                  # interactive TUI (default)
otto "explain this stack trace"       # one-shot prompt
otto "write tests" --agent build
otto "review the architecture" --agent plan
otto "research this codebase" --agent research
otto --last "continue"                # resume last session
otto web                              # open this project in the Web UI
otto web --url http://localhost:3000  # open Web UI for an existing API
otto serve --port 3000                # advanced: API on :3000, web UI on :3001
otto serve --network                  # bind for LAN access
```

Companion commands:

```bash
otto setup          otto auth login      otto auth list
otto doctor         otto sessions        otto models
otto agents         otto tools           otto skills
otto mcp list       otto scaffold
```

### Canvas

Canvas is otto's native tiled workspace — a Tauri + React desktop app where each pane is a first-class block.

| Block | What it does | Powered by |
|---|---|---|
| **Terminal** | GPU-rendered native terminal | [Ghostty](https://ghostty.org) (libghostty) |
| **Browser** | Inline preview for localhost or any URL | macOS WKWebView |
| **Otto** | AI chat with full tool access to your repo | local otto runtime |
| **Claude Code** | Claude Code in a Ghostty surface | Ghostty preset |
| **Codex** | OpenAI Codex in a Ghostty surface | Ghostty preset |
| **Otto TUI** | Run the otto TUI inside Canvas | Ghostty preset |
| **OpenCode** | OpenCode in a Ghostty surface | Ghostty preset |
| **Custom command** | Any shell command as a terminal block | Ghostty preset |

- **Multi-workspace** — each workspace binds to a project path and launches its own local otto runtime
- **Tabs & splits** — `⌘N` add block · `⌘T` new tab · `⌘D` split right · `⌘⇧D` split down · `⌘1-9` switch · `Ctrl+H/J/K/L` vim nav
- **Shareable layouts** — export tabs, splits, and presets as `otto.yaml`
- **Native performance** — libghostty + WKWebView, no Electron

Run locally:

```bash
cd apps/canvas
bun install
bun tauri dev       # dev mode
bun tauri build     # .app / .dmg
```

> Canvas currently targets macOS. Linux and Windows support is on the roadmap.

---

## Agents

Built-in presets from `@ottocode/server`:

| Agent | Purpose | Tool profile |
|---|---|---|
| `build` | Code changes, fixes, implementation | Full patch/search/shell |
| `plan` | Analysis and planning | Read/search/task |
| `research` | Cross-session and web research | Read/search/web + research DB |
| `general` | Mixed-purpose assistant | Broad workspace default |

All agents include `progress_update`, `finish`, and `skill`.

Override per-project in `.otto/agents.json` or globally in `~/.config/otto/agents.json`. Prompt files live at `.otto/agents/<name>.md`.

---

## Tools

The built-in tool surface available to agents:

| Category | Tools |
|---|---|
| **File system** | `read` · `write` · `ls` · `tree` · `pwd` · `cd` · `glob` |
| **Search** | `search` · `websearch` |
| **Editing** | `apply_patch` |
| **Shell** | `shell` · `terminal` |
| **Git** | `git_status` · `git_diff` · `git_commit` |
| **Agent control** | `update_todos` · `progress_update` · `finish` · `skill` |
| **Research** | `query_sessions` · `query_messages` · `get_session_context` · `search_history` · `get_parent_session` · `present_action` |

### MCP servers

otto speaks MCP over stdio, HTTP, and SSE. Tools register as `server__tool`.

```bash
otto mcp add helius --command npx --args -y helius-mcp@latest
otto mcp add linear --transport http --url https://mcp.linear.app/mcp
otto mcp list
otto mcp auth linear
```

See [docs/mcp.md](docs/mcp.md).

### Custom tools

Drop a plugin in `.otto/tools/<name>/tool.js`:

```js
export default {
  name: 'file_size',
  description: 'Return the byte size for a file path',
  parameters: {
    path: { type: 'string', description: 'Path to inspect' },
  },
  async execute({ input, fs }) {
    const content = await fs.readFile(input.path, 'utf8');
    return { bytes: Buffer.byteLength(content, 'utf8') };
  },
};
```

See [docs/customization.md](docs/customization.md).

### Skills

Load markdown instruction bundles on demand with the `skill` tool. Sources:

- Built-in bundled skills
- `.otto/skills/` · `.agents/skills/`
- `~/.config/otto/skills/` · `~/.agents/skills/`

Run `otto skills` to list what's available.

---

## Providers

Set environment variables for the providers you want:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GOOGLE_GENERATIVE_AI_API_KEY="..."
export OPENROUTER_API_KEY="..."
export OPENCODE_API_KEY="..."
export OTTOROUTER_PRIVATE_KEY="..."          # Solana wallet (base58)
export KIMI_API_KEY="..."
export MINIMAX_API_KEY="..."
export ZAI_API_KEY="..."
export ZAI_CODING_API_KEY="..."
```

Full list: [docs/environment.md](docs/environment.md).

---

## Configuration

| Scope | Path |
|---|---|
| Global config | `~/.config/otto/` |
| Project config | `.otto/` |
| Auth (macOS) | `~/Library/Application Support/otto/auth.json` |
| Auth (Linux) | `$XDG_STATE_HOME/otto/auth.json` |
| Auth (Windows) | `%APPDATA%/otto/auth.json` |

Secrets are stored in OS-secure locations — never in the config directory.

See [docs/configuration.md](docs/configuration.md).

---

## Embedding

Run the otto server inside your own app:

```ts
import { createEmbeddedApp } from '@ottocode/server';
import { serveWebUI } from '@ottocode/web-ui';

const api = createEmbeddedApp({
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  apiKey: process.env.ANTHROPIC_API_KEY,
  agent: 'build',
});

const web = serveWebUI({ prefix: '/ui' });

Bun.serve({
  port: 3456,
  idleTimeout: 240,
  async fetch(req) {
    return (await web(req)) ?? api.fetch(req);
  },
});
```

See [docs/embedding-guide.md](docs/embedding-guide.md).

### API

The server exposes:

- `/` — root text response
- `/openapi.json` — generated OpenAPI document (source of truth for clients)
- `/v1/*` — operational routes: `ask`, `auth`, `config`, `doctor`, `files`, `git`, `mcp`, `provider-usage`, `research`, `sessions`, `ottorouter`, `shares`, `skills`, `terminals`, `tunnel`

See [docs/api.md](docs/api.md).

---

## Repository

A single Bun monorepo.

**Apps** (`apps/`)
`canvas` · `cli` · `desktop` · `intro-video` · `landing` · `launcher` · `mobile` · `preview-api` · `preview-web` · `tui` · `web`

**Packages** (`packages/`)
`@ottocode/acp` · `@ottocode/ai-sdk` · `@ottocode/api` · `@ottocode/database` · `@ottocode/install` · `@ottocode/openclaw` · `@ottocode/sdk` · `@ottocode/server` · `@ottocode/web-sdk` · `@ottocode/web-ui`

**Infra** (`infra/`) — SST modules
`script` · `landing` · `preview-api` · `preview-web` · `og`

See [docs/architecture.md](docs/architecture.md).

---

## Development

```bash
git clone https://github.com/nitishxyz/otto.git
cd otto
bun install
bun lint
bun test
bun run typecheck
bun run compile
```

Common dev commands:

```bash
bun run dev:cli
bun run --filter @ottocode/tui dev
bun run dev:web
bun run dev:desktop
bun sst dev
```

See [docs/development.md](docs/development.md).

---

## Docs

- [Getting Started](docs/getting-started.md)
- [Usage Guide](docs/usage.md)
- [Configuration](docs/configuration.md)
- [Agents & Tools](docs/agents-tools.md)
- [MCP](docs/mcp.md)
- [API](docs/api.md)
- [Architecture](docs/architecture.md)
- [Embedding Guide](docs/embedding-guide.md)
- [Development](docs/development.md)
- [Docs Index](docs/index.md)

---

## Contributing

Conventions in [AGENTS.md](AGENTS.md). In short:

- Bun for everything (install, run, build, test)
- Biome for lint and format
- `bun:test` for tests
- TypeScript strict mode
- Small, focused PRs

---

## License

[MIT](LICENSE)
