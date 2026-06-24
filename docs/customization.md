# Customization

[← Back to README](../README.md) • [Docs Index](./index.md)

Customize otto with project-local `.otto/` files or global `~/.config/otto/` files.

## Recipes

Recipes are project-local markdown instructions that become reusable slash commands in chat. They are discovered from:

- `.otto/recipes/*.md`

The filename is the command name, so `.otto/recipes/publish-ready.md` runs with `/publish-ready`. Recipe names must use lowercase letters, numbers, and dashes.

### Example

Create `.otto/recipes/publish-ready.md`:

```md
---
description: Set publish flags and verify readiness
agent: build
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

Arguments after the recipe name are passed to Otto as recipe arguments. Recipes run through the normal agent flow and keep the usual tool approval, editing, and safety rules. The optional `agent` frontmatter chooses which agent runs the recipe; it defaults to `build`, and unavailable agents fall back to `build`. You can also ask Otto to create or edit a recipe; it should write markdown files under `.otto/recipes/`.

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

## Custom tools

Custom tools are plugin folders discovered from:

- `.otto/tools/<tool-name>/tool.js`
- `.otto/tools/<tool-name>/tool.mjs`
- `~/.config/otto/tools/<tool-name>/tool.js`
- `~/.config/otto/tools/<tool-name>/tool.mjs`

The loader expects a descriptor object or a factory function returning one.

### Descriptor shape

```ts
{
  name?: string;
  description?: string;
  parameters?: Record<string, {
    type: 'string' | 'number' | 'boolean';
    description?: string;
    default?: string | number | boolean;
    enum?: string[];
    optional?: boolean;
  }>;
  execute?: (args) => unknown | Promise<unknown>;
  run?: (args) => unknown | Promise<unknown>;
  handler?: (args) => unknown | Promise<unknown>;
  setup?: (context) => unknown | Promise<unknown>;
  onInit?: (context) => unknown | Promise<unknown>;
}
```

`execute`, `run`, or `handler` can be used as the entrypoint.

### Example tool

Create `.otto/tools/file-size/tool.js`:

```js
export default {
  name: 'file_size',
  description: 'Get the byte size of a file',
  parameters: {
    path: {
      type: 'string',
      description: 'Path to inspect',
    },
  },
  async execute({ input, fs }) {
    const content = await fs.readFile(input.path, 'utf8');
    return { bytes: Buffer.byteLength(content, 'utf8') };
  },
};
```

### Helper context

Tool executors receive helpers including:

- `input` — validated input object
- `project` / `projectRoot`
- `directory` / `worktree`
- `exec()` / `run()` — run a command
- ``$`` — template-string command helper
- `fs.readFile()` / `fs.writeFile()` / `fs.exists()`
- `env` — environment variables
- `context` — tool/plugin metadata including `toolDir`

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

Compatibility aliases are also supported at `.agenst/skills/` and `~/.agenst/skills/`.

Use `otto skills` to inspect them, or the `skill` tool from the runtime.
