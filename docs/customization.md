# Customization

[← Back to README](../README.md) • [Docs Index](./index.md)

Customize otto with project-local `.otto/` files or global `~/.config/otto/` files.

## Forge

`forge` is the loadable agent tool for creating, managing, and running Otto
capabilities. It can inventory the current project, preview changes, create,
update, or remove standalone recipes, skills, and agents, manage MCP servers,
and run enabled plugin commands in visible terminals.

- Project scope writes under `.otto/`.
- Global scope writes under `~/.config/otto/`.
- Project scope is the default; global scope must be requested explicitly.
- `inventory` and `plan` are read-only. Mutations follow normal tool approval.
- `dryRun: true` returns the exact paths and generated content without writing.
- MCP servers support create, update, remove, enable, disable, start, stop, and
  restart operations for stdio, HTTP, and SSE transports.
- Plugin commands use `action: "execute"` and `kind: "plugin-command"`.

Load it before use:

```text
load_tools({ tools: ['forge'] })
```

Plugins remain the packaging and distribution format. Forge creates standalone
capabilities directly; those capabilities can be packaged as plugins in a later
workflow without requiring every project customization to be a plugin.

Forge replaces the former `mcp_manager` and `run_plugin_command` entries in the
loadable tool catalog. Their underlying MCP and plugin command runtimes remain
shared infrastructure; Forge is the unified agent-facing interface.

## Recipes

Recipes are project or global markdown instructions that become reusable slash commands in chat. They are discovered from:

- `.otto/recipes/*.md`
- `~/.config/otto/recipes/*.md`

The filename is the command name, so `.otto/recipes/publish-ready.md` runs with `/publish-ready`. Recipe names must use lowercase letters, numbers, and dashes.

### Example

Create `.otto/recipes/publish-ready.md`:

```md
---
description: Set publish flags and verify readiness
agent: build
includeInHistory: false
---

Update `publish.env` for publishing.

Set the relevant publish flags to `true`, preserve unrelated values and comments, then run `bun lint` and summarize the result.

Do not commit.
```

Usage:

```text
/publish-ready
/publish-ready web cli
```

Arguments after the recipe name are passed to Otto as recipe arguments. Recipes run through the normal agent flow and keep the usual tool approval, editing, and safety rules. The optional `agent` frontmatter chooses which agent runs the recipe; it defaults to `build`, and unavailable agents fall back to `build`. By default, recipes are included in session history, so they can use prior context and remain in future context. Set `includeInHistory: false` when a recipe should run isolated from session history. Set `oneShot: true` when it should execute autonomously without conversational questions or confirmation; configured tool approval controls still apply. You can also ask Otto to create or edit a recipe; it should write markdown files under `.otto/recipes/`.

Otto also ships immutable built-in recipes. `/init` is a built-in recipe that uses the `build` agent to generate repository agent documentation autonomously. Built-in recipes are reserved, cannot be overridden by project, global, or plugin recipes, and are not shown in editable recipe settings or CRUD APIs.

## Custom commands

Command manifests are discovered from:

- `.otto/commands/*.json`
- `~/.config/otto/commands/*.json`

A command can optionally load a sibling prompt file like `commit.md` or `commit.txt`.

### Example

Create `.otto/commands/commit.json`:

```json
{
  "name": "commit",
  "description": "Generate a commit message from staged changes",
  "agent": "commit",
  "interactive": true,
  "promptTemplate": "Generate a commit message for these changes:\n{input}",
  "confirm": {
    "required": true,
    "message": "Proceed with this commit message?"
  }
}
```

Usage:

```bash
otto commit
otto commit "focus on the auth refactor"
```

Supported manifest fields:

| Field | Meaning |
|---|---|
| `name` | Command name |
| `description` | Help/interactive description |
| `agent` | Agent used for the command |
| `prompt` | Inline prompt |
| `promptPath` | Relative or absolute prompt file path |
| `promptTemplate` | Prompt template, typically using `{input}` |
| `defaults` | Default `provider`, `model`, or `agent` |
| `confirm` | Confirmation policy/message |
| `interactive` | Prompt for input if none was supplied |

## Native plugin tools

Plugins can contribute TypeScript or JavaScript tools through `otto.plugin.json`.
Native tools run in an isolated child process using the Bun runtime bundled with
the Otto CLI. Their code is imported only when the tool is called, and one host
is reused per project/plugin pair until it exits or is restarted.

```json
{
  "name": "project-info",
  "version": "1.0.0",
  "tools": [
    {
      "name": "summary",
      "entry": "tools/summary.ts",
      "description": "Summarize project metadata",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string" }
        },
        "required": ["path"],
        "additionalProperties": false
      },
      "effects": ["workspace-read"],
      "timeoutMs": 120000
    }
  ]
}
```

Native plugin tools are always loadable and never enter the first-class tool set.
The model-facing name is namespaced as `project-info__summary`. Supported effects
are `workspace-read`, `workspace-write`, `process`, `network`, `secrets`, and
`external-write`. Effects participate in dangerous-mode approval decisions.
Tools can also declare `outputSchema` and scoped secrets such as
`{"name":"token","env":"SERVICE_TOKEN"}`. A tool declaring secrets must include
the `secrets` effect.

An entry exports a function or an object with an `execute` function:

```ts
import type { NativeToolHandler } from '@ottocode/sdk/tool-extension';

export default (async (input, context) => {
  context.progress('Reading project metadata');
  const content = await context.workspace.readText(String(input.path));
  const calls = (await context.storage.get<number>('calls')) ?? 0;
  await context.storage.set('calls', calls + 1);
  return { characters: content.length, calls: calls + 1 };
}) satisfies NativeToolHandler;
```

Useful context APIs include `workspace`, `process`, `progress`, `secrets`,
`storage`, and `output.image()`. Validate and run a local plugin with:

```bash
otto plugins validate ./my-plugin
otto plugins dev ./my-plugin summary --input '{"path":"README.md"}'
```

See [Native Tool Extension Architecture](./plans/native-tool-extension-architecture.md)
for the runtime and trust model.

## Custom agents

Agent config lives in:

- `.otto/agents.json`
- `~/.config/otto/agents.json`

Prompt files typically live at:

- `.otto/agents/<name>.md`
- `~/.config/otto/agents/<name>.md`

Example:

```json
{
  "reviewer": {
    "tools": ["read", "ls", "tree", "search", "update_todos"],
    "prompt": ".otto/agents/reviewer.md",
    "provider": "anthropic",
    "model": "claude-sonnet-4"
  }
}
```

## Skills

Skills are markdown-based instruction bundles discovered from:

- `.otto/skills/`
- `.agents/skills/`
- `~/.config/otto/skills/`
- `~/.agents/skills/`
- built-in bundled skills

Use `otto skills` to inspect them, or the `skill` tool from the runtime.
