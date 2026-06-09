# Embedding otto

[← Back to README](../README.md) • [Docs Index](./index.md)

Use otto's server and UI packages inside your own Bun/Node application.

## Main packages

- `@ottocode/server` — embedded Hono app and built-in agent/tool metadata
- `@ottocode/web-ui` — prebuilt web UI assets and `serveWebUI()`
- `@ottocode/api` — generated client if you want to talk to an otto server externally
- `@ottocode/sdk` — lower-level runtime utilities

## Minimal embedded server

```ts
import { createEmbeddedApp } from '@ottocode/server';

const app = createEmbeddedApp({
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  agent: 'build',
});

Bun.serve({
  port: 3456,
  idleTimeout: 240,
  fetch: app.fetch,
});
```

## Embedded server + web UI

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

That gives you:

- API routes on `/`, `/openapi.json`, and `/v1/*`
- browser UI on `/ui`

## Built-in agents

`@ottocode/server` exports the current built-in presets:

```ts
import { BUILTIN_AGENTS, type BuiltinAgent } from '@ottocode/server';

const agent: BuiltinAgent = 'research';
console.log(Object.keys(BUILTIN_AGENTS));
// ['build', 'plan', 'general', 'research']
```

Typical uses:

- `build` — implementation and code changes
- `plan` — architecture/planning
- `general` — mixed workflows
- `research` — research across sessions/history/web

## Built-in tools

```ts
import { BUILTIN_TOOLS, type BuiltinTool } from '@ottocode/server';

const safeTools: BuiltinTool[] = BUILTIN_TOOLS.filter(
  (tool) => !['shell', 'write', 'git_commit'].includes(tool),
);
```

`BUILTIN_TOOLS` is the full exported built-in tool universe. A given agent does
**not** automatically receive all of them — use `BUILTIN_AGENTS.<agent>.tools`
to see the actual default tool list for that preset.

Current exported tool names include file, search, patch, git, terminal, control, and research helpers such as:

- `read`, `write`, `ls`, `tree`, `pwd`, `cd`, `glob`
- `search`, `websearch`
- `apply_patch`
- `shell`, `terminal`
- `git_status`, `git_diff`, `git_commit`
- `update_todos`, `progress_update`, `finish`, `skill`
- `query_sessions`, `query_messages`, `get_session_context`, `search_history`, `get_parent_session`, `present_action`

## Config fallback model

Embedded otto still follows the normal resolution order:

1. injected config (`createEmbeddedApp({...})`)
2. environment variables
3. project config (`.otto/...`)
4. global config (`~/.config/otto/...`)
5. built-in defaults

Auth secrets use secure OS-specific storage when they are not injected:

| Platform | Auth path |
|---|---|
| macOS | `~/Library/Application Support/otto/auth.json` |
| Linux | `$XDG_STATE_HOME/otto/auth.json` or `~/.local/state/otto/auth.json` |
| Windows | `%APPDATA%/otto/auth.json` |

## Embedded config shape

```ts
import type { EmbeddedAppConfig } from '@ottocode/server';

const config: EmbeddedAppConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  agent: 'build',
  defaults: {
    provider: 'openai',
    model: 'gpt-4o',
    agent: 'build',
    toolApproval: 'auto',
  },
  corsOrigins: ['https://myapp.example.com'],
};
```

Useful fields:

- `provider`, `model`, `apiKey`
- `agent`
- `auth` for multi-provider injected auth
- `agents` for agent overrides
- `defaults` for fallback defaults
- `corsOrigins` for reverse proxies, custom domains, or Tailscale-style deployments

## Customizing built-in agents

```ts
import { BUILTIN_AGENTS, createEmbeddedApp } from '@ottocode/server';

const app = createEmbeddedApp({
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  apiKey: process.env.ANTHROPIC_API_KEY,
  agent: 'general',
  agents: {
    general: {
      ...BUILTIN_AGENTS.general,
      tools: ['read', 'ls', 'tree', 'search', 'update_todos', 'websearch'],
    },
  },
});
```

## Project and global overrides still work

If you do not inject everything explicitly, embedded otto can still read:

- `.otto/config.json`
- `.otto/agents.json`
- `.otto/agents/<name>.md`
- `~/.config/otto/config.json`
- `~/.config/otto/agents.json`

Custom tools can still be discovered from:

- `.otto/tools/<tool-name>/tool.js`
- `.otto/tools/<tool-name>/tool.mjs`
- `~/.config/otto/tools/<tool-name>/tool.js`
- `~/.config/otto/tools/<tool-name>/tool.mjs`

## API routing expectations

Your embedded server should expose the same route layout as the standalone runtime:

- `/`
- `/openapi.json`
- `/v1/*`

If you mount behind a reverse proxy, keep `/v1/*` reachable or rewrite consistently for your client.

## Client guidance

- prefer `@ottocode/api` if you are calling an otto server from another process
- use `serveWebUI()` when you want the browser UI without rebuilding the frontend yourself
- set `idleTimeout` high enough for SSE streaming workloads
