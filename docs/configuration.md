# Configuration

[← Back to README](../README.md) • [Docs Index](./index.md)

otto resolves configuration from injected settings, environment variables, global config, and project config.

## Resolution order

When otto needs a value, it checks in this order:

```text
1. Injected config (for embedded/server integrations)
2. Environment variables
3. Project config (.otto/...)
4. Global config (~/.config/otto/...)
5. Built-in defaults
```

Auth secrets are a special case: they are stored in a secure OS-specific path, not in the global config directory.

## Directory layout

### Global config directory

```text
~/.config/otto/
├── config.json
├── agents.json
├── agents/
├── commands/
├── tools/
└── skills/
```

### Secure auth + OAuth storage

| Platform | Auth path | OAuth directory |
|---|---|---|
| macOS | `~/Library/Application Support/otto/auth.json` | `~/Library/Application Support/otto/oauth/` |
| Linux | `$XDG_STATE_HOME/otto/auth.json` or `~/.local/state/otto/auth.json` | `$XDG_STATE_HOME/otto/oauth/` or `~/.local/state/otto/oauth/` |
| Windows | `%APPDATA%/otto/auth.json` | `%APPDATA%/otto/oauth/` |

### Project directory

Project-local `.otto/` contains commit-safe configuration and extension files only:

```text
.otto/
├── config.json
├── agents.json
├── agents/
│   ├── <name>.md
│   └── <name>.txt
├── commands/
│   ├── <command>.json
│   ├── <command>.md
│   └── <command>.txt
├── plugins/
│   └── <plugin-name>/
│       └── otto.plugin.json
└── skills/
```

Runtime state is stored outside the project directory under a per-project state
directory:

```text
$OTTO_HOME/projects/<project-id>/
├── otto.sqlite
├── attachments/
├── cache/
├── debug/
├── debug-dumps/
├── logs/
└── tmp/
```

If `OTTO_HOME` is unset, otto uses the platform state directory. On Linux this
is typically `~/.local/state/otto/projects/<project-id>/`.

Notes:

- the CLI scaffolder writes agent prompts as `.otto/agents/<name>.md`
- command prompts can live next to the JSON manifest as `<command>.md` or `<command>.txt`
- the runtime still accepts some legacy nested agent prompt paths, but the flat layout above is the current default

## Global files

### `~/.config/otto/config.json`

User-wide defaults.

```json
{
  "defaults": {
    "provider": "anthropic",
    "model": "claude-sonnet-4",
    "agent": "build"
  }
}
```

### `~/.config/otto/agents.json`

Global agent overrides.

```json
{
  "build": {
    "appendTools": ["git_diff"],
    "prompt": "agents/build.md"
  }
}
```

`prompt` can be inline text, a relative path from the config directory, or an absolute path.

## Project files

### `.otto/config.json`

Project-level defaults and provider preferences.

```json
{
  "defaults": {
    "provider": "openai",
    "model": "gpt-4o",
    "agent": "build"
  },
  "providers": {
    "openai": { "enabled": true },
    "anthropic": { "enabled": true },
    "google": { "enabled": false }
  }
}
```

Provider entries may also include richer settings such as custom base URLs,
explicit API key env vars, static model lists, and custom declarative providers.

Example custom provider:

```json
{
  "defaults": {
    "provider": "my-ollama",
    "model": "qwen2.5-coder:14b"
  },
  "providers": {
    "my-ollama": {
      "enabled": true,
      "custom": true,
      "label": "Local Ollama",
      "compatibility": "ollama",
      "family": "default",
      "baseURL": "http://127.0.0.1:11434",
      "apiKeyEnv": "OLLAMA_API_KEY",
      "modelDiscovery": { "type": "ollama" },
      "allowAnyModel": false
    }
  }
}
```

For `compatibility: "ollama"`, use the canonical Ollama base URL without
`/api` or `/api/chat`. The provider add flow can auto-discover models and
capabilities from Ollama using `/api/tags` and `/api/show`.

Supported provider fields:

| Field | Meaning |
|---|---|
| `enabled` | Whether the provider is selectable |
| `custom` | Marks a provider as config-defined rather than built-in |
| `label` | Human-readable provider name |
| `compatibility` | Transport/protocol mode: `openai`, `anthropic`, `google`, `openrouter`, `openai-compatible`, or `ollama` |
| `family` | Prompt/behavior family, typically `default`, `openai`, `anthropic`, `google`, `kimi`, `glm`, or `minimax` |
| `baseURL` | Override the upstream endpoint |
| `apiKey` | Inline API key (prefer env vars when possible) |
| `apiKeyEnv` | Environment variable to read the API key from |
| `models` | Static allowed models as IDs or full metadata objects |
| `allowAnyModel` | Accept arbitrary model IDs instead of enforcing `models` |
| `modelDiscovery` | Optional discovery mode such as `ollama` |

CLI helpers:

```bash
otto providers list
otto providers add
otto providers remove my-ollama
```

### `.otto/agents.json`

Per-project agent overrides.

```json
{
  "build": {
    "appendTools": ["git_diff", "glob"]
  },
  "reviewer": {
    "tools": ["read", "ls", "tree", "search", "update_todos"],
    "prompt": ".otto/agents/reviewer.md",
    "provider": "anthropic",
    "model": "claude-sonnet-4"
  }
}
```

Supported fields:

| Field | Meaning |
|---|---|
| `tools` | Replace the default tool list |
| `appendTools` | Add to the default tool list |
| `prompt` | Inline prompt text or prompt file path |
| `provider` | Per-agent provider override |
| `model` | Per-agent model override |

### Auth file shape

Secure auth storage uses provider entries like:

```json
{
  "openai": {
    "type": "api",
    "key": "sk-..."
  },
  "anthropic": {
    "type": "api",
    "key": "sk-ant-..."
  }
}
```

Most users should prefer `otto setup` or `otto auth login` instead of editing auth files manually.

## Environment variables

Common provider variables:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
OPENROUTER_API_KEY=...
OPENCODE_API_KEY=...
OTTOROUTER_PRIVATE_KEY=...
KIMI_API_KEY=...
MINIMAX_API_KEY=...
ZAI_API_KEY=...
ZAI_CODING_API_KEY=...
```

See [environment.md](./environment.md) for the verified list.

## Embedded mode

Embedded integrations can inject config directly:

```ts
import { createEmbeddedApp } from '@ottocode/server';

const app = createEmbeddedApp({
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  agent: 'build',
});
```

## MCP configuration

Configure MCP servers in either project or global config:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "github",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
      },
      {
        "name": "linear",
        "transport": "http",
        "url": "https://mcp.linear.app/mcp"
      }
    ]
  }
}
```

OAuth tokens for remote MCP servers are stored in the secure OAuth directory shown above.
