# Getting Started

[← Back to README](../README.md) · [Docs Index](./index.md)

---

## Install

### Recommended

```bash
curl -fsSL https://install.ottocode.io | sh
```

To pin a release explicitly:

```bash
OTTO_VERSION=v0.1.231 curl -fsSL https://install.ottocode.io | sh
```

If you do not need a pinned version, prefer the default installer invocation above.

### Via Bun

```bash
bun install -g @ottocode/install
```

### From source

```bash
git clone https://github.com/nitishxyz/otto.git
cd otto
bun install
bun run compile
```

---

## Configure a provider

Interactive setup:

```bash
otto setup
```

Or set credentials directly:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GOOGLE_GENERATIVE_AI_API_KEY="..."
export OPENROUTER_API_KEY="..."
export ZAI_CODING_API_KEY="..." # GLM Coding Plan
```

For Z.AI's GLM Coding Plan, use the separate `zai-coding` provider. It uses
the Z.AI API key from your subscribed Coding Plan account, not OAuth:

```bash
otto auth login zai-coding
otto --provider zai-coding --model glm-5.2
```

Use `zai` for the general Z.AI API endpoint and `zai-coding` for the dedicated
Coding Plan endpoint.

You can inspect what otto sees with:

```bash
otto doctor
otto auth list
```

---

## First commands

```bash
otto
otto web
otto "explain this error"
otto "write tests for this module" --agent build
otto "plan the refactor" --agent plan
otto "research auth handling" --agent research
```

Behavior notes:

- `otto` starts the local API server and launches the TUI
- `otto web` reuses the local daemon and opens this project in the browser UI
- `otto web --url <api-url>` opens the browser UI for an existing API URL without starting a local API server
- one-shot prompts stream through the same local server runtime

---

## Advanced server mode

```bash
otto serve
otto serve --port 3000
otto serve --network
otto serve --no-open
```

When you run `otto serve --port 3000`:

- API listens on `http://localhost:3000`
- Web UI is served on `http://localhost:3001`

Use `otto serve` for standalone foreground API/Web serving. For normal browser use, prefer `otto web`.

The API is versioned under `/v1/*`, and `/openapi.json` exposes the generated spec.

---

## Config file locations

Global config:

```text
~/.config/otto/config.json
~/.config/otto/agents.json
~/.config/otto/tools/
~/.config/otto/commands/
```

Secure auth storage:

- macOS: `~/Library/Application Support/otto/auth.json`
- Linux: `$XDG_STATE_HOME/otto/auth.json` or `~/.local/state/otto/auth.json`
- Windows: `%APPDATA%/otto/auth.json`

Project config:

```text
.otto/config.json
.otto/agents.json
.otto/agents/<name>.md
.otto/tools/<tool-name>/tool.js
```

---

## Troubleshooting quick checks

### `otto` not found

Make sure your install path is on `PATH`:

```bash
echo $PATH | tr ':' '\n' | grep local
```

### Provider/auth problems

```bash
otto doctor
otto auth login
otto auth list
```

### Server route check

```bash
curl http://localhost:3000/
curl http://localhost:3000/openapi.json
curl http://localhost:3000/v1/server/info
```

### Need more help?

- [Usage Guide](usage.md)
- [Configuration](configuration.md)
- [Agents & Tools](agents-tools.md)
- [Troubleshooting](troubleshooting.md)
