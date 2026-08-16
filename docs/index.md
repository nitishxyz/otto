# otto documentation

[← Back to README](../README.md)

## Getting started

- [Installation & Quick Start](getting-started.md)
- [Usage Guide](usage.md)
- [Configuration](configuration.md)
- [Environment Variables](environment.md)

## Core features

- [Agents & Tools](agents-tools.md)
- [MCP Servers](mcp.md)
- [Customization](customization.md)
- [Local Dictation](dictation.md)
- [API Reference](api.md)
- [Troubleshooting](troubleshooting.md)

## Architecture & development

- [Architecture](architecture.md)
- [Development](development.md)
- [Development Guide](development-guide.md)
- [Official Ghostty VT WebAssembly](ghostty-vt-wasm.md)
- [Publishing](publishing.md)
- [Release changelogs](release-changelog.md)
- [Contributing](../AGENTS.md)

## Advanced

- [Embedding Guide](embedding-guide.md)
- [Keyboard Shortcuts](keyboard-shortcuts.md)
- [License](license.md)

## Brand

- [Brand assets (ShipWheel mark, lockups, usage)](../assets/brand/README.md)

---

## Quick reference

### Install

```bash
curl -fsSL https://install.ottocode.io | sh
bun install -g @ottocode/install
```

### Common commands

```bash
otto
otto web
otto "fix this bug"
otto "plan this refactor" --agent plan
otto "research this subsystem" --agent research
otto serve  # advanced standalone server
otto setup
otto doctor
```

### Workspace layout

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
│   ├── plugin-registry/
│   ├── sdk/
│   ├── server/
│   ├── themes/
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

### API shape

- `/` — root route
- `/openapi.json` — OpenAPI source of truth
- `/v1/*` — operational API routes

### Current SST modules

- `infra/script`
- `infra/landing`
- `infra/preview-api`
- `infra/preview-web`
- `infra/og`
