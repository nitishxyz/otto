# Plugin Capabilities & Commands Plan

## Goal

Make plugins the umbrella packaging format for reusable Otto capabilities:

- Skills: reusable knowledge and context
- Recipes: slash-invokable agent workflows
- Agents: reusable specialist agents
- Commands: runnable host commands exposed through slash UX and UI
- MCP servers: plugin-provided MCP server definitions and lifecycle helpers
- Browser previews: plugin-declared preview URLs for companion services

The desired end state is that a plugin can be as small as one recipe or one agent, or as complete as a full integration bundle.

```txt
serve-sim plugin
  ├─ skill:    serve-sim usage guidance
  ├─ recipe:   /inspect-ios-app
  ├─ agent:    sim_inspector
  ├─ command:  /serve-sim start --port 3200
  ├─ MCP:      optional simulator MCP server config
  └─ browser:  http://localhost:3200 preview
```

## Current State

### Already working

- Plugin discovery, install, enable/disable, project/global precedence.
- Plugin skills are loaded from enabled installed plugins.
- Plugin recipes are now loaded and invokable from enabled installed plugins.
- Plugin agents are now loaded into the agent registry from enabled installed plugins.
- Plugin manifests can include `mcpServers`, `commands`, and `browser` metadata.
- Plugin manifests can declare `dependencies` (other plugin names). Installing a plugin recursively installs its dependencies from the configured registries, with a cycle guard. Already-installed dependencies are left as-is. Dependencies whose registry entry targets other platforms are skipped. Each dependency's config entry records provenance in `installedBy`; removing a parent plugin clears its `installedBy` references but does not cascade-remove dependencies.

### Not working yet

- Plugin commands are parsed/listed as manifest metadata only; there is no runtime execution path.
- Plugin commands are not slash commands.
- Plugin command args are not described well enough for rich autocomplete.
- Agents are not automatically informed about available plugin commands.
- Agents do not have a `run_plugin_command` tool.
- Plugin MCP definitions are not yet installed/activated as project/global MCP server config.
- Plugin MCP lifecycle is not unified with plugin commands.

## Design Principle

Plugins should package capabilities. Otto should expose those capabilities through the most natural surface:

```txt
Capability  Runtime surface
──────────  ─────────────────────────────────────────────
skill       skill loader / skill tool
recipe      slash recipe: /release-check
agent       agent registry / picker / delegation
command     plugin slash namespace: /serve-sim start
MCP         MCP registry / tools / lifecycle commands
browser     preview affordance in UI and command output
```

Plugin commands should not be confused with recipes:

- A recipe is an instruction workflow executed by an agent.
- A command is a concrete host process invocation.

## Plugin Manifest Shape

A plugin should be able to include any subset of fields:

```json
{
  "name": "serve-sim",
  "version": "1.0.0",
  "description": "Apple Simulator workflows via serve-sim.",

  "skills": [
    {
      "name": "serve-sim",
      "path": "skills/serve-sim/SKILL.md",
      "description": "Control and stream an Apple Simulator."
    }
  ],

  "recipes": [
    {
      "name": "inspect-ios-app",
      "path": "recipes/inspect-ios-app.md",
      "description": "Inspect a running iOS Simulator app."
    }
  ],

  "agents": [
    {
      "name": "sim_inspector",
      "path": "agents/sim-inspector.md",
      "description": "Specialist for inspecting iOS Simulator apps.",
      "tools": {
        "firstClass": ["read", "shell", "terminal"],
        "loadable": ["simulator", "browser"]
      }
    }
  ],

  "commands": {
    "start": {
      "label": "Start serve-sim",
      "description": "Start the serve-sim preview server.",
      "command": "bun",
      "args": ["x", "serve-sim@latest", "--port", "{port}"],
      "parameters": {
        "port": {
          "type": "string",
          "default": "3200",
          "description": "Preview server port."
        }
      },
      "fallback": {
        "command": "npx",
        "args": ["--yes", "serve-sim@latest", "--port", "{port}"]
      }
    },
    "doctor": {
      "label": "Check simulator dependencies",
      "description": "List available Simulator devices.",
      "command": "xcrun",
      "args": ["simctl", "list", "devices"]
    }
  },

  "mcpServers": {
    "serve-sim": {
      "command": "bun",
      "args": ["x", "serve-sim-mcp@latest"],
      "env": {}
    }
  },

  "browser": {
    "previewUrl": "http://localhost:3200"
  }
}
```

## Command UX

Use plugin names as slash namespaces:

```txt
/<plugin-name> <command-name> [args...]
```

Examples:

```txt
/serve-sim start --port 3200
/serve-sim doctor
/playwright install
/expo start --ios
```

Plugin names as slash namespaces keep commands discoverable without a separate generic command prefix.

### Autocomplete behavior

The slash popup should guide the user progressively.

```txt
User types:
  /

Popup shows:
  built-in commands
  recipes
  plugin namespaces
```

```txt
User types:
  /serve-sim

Popup shows plugin commands:
  start    Start serve-sim
  doctor   Check simulator dependencies
```

```txt
User selects/types:
  /serve-sim start --

Popup shows parameters:
  --port   Preview server port, default 3200
```

### Return key behavior

When a plugin namespace is selected and it has commands:

- Pressing return on `/serve-sim` should not immediately execute anything.
- It should open/narrow the popup to the plugin command list.
- Pressing return on `/serve-sim start` should execute if required args are satisfied.
- If required args are missing, keep focus in the input and show parameter suggestions/errors.

This makes command discovery safe and learnable.

## Command Execution

Plugin commands are user-facing actions, so they should run in a visible terminal by default. This keeps command output separate from chat, works even when there is no active session, and gives users a place to inspect logs, interrupt long-running processes, or copy output.

Expected behavior:

- Start a visible terminal for every plugin command.
- Give it a clear purpose/title, e.g. `serve-sim start 3200` or `serve-sim doctor`.
- Reuse or detect existing matching terminals where possible.
- Surface preview URL if `browser.previewUrl` exists.
- Show exit status/output in the terminal, not as a chat transcript by default.
- Let users stop long-running commands through existing terminal controls.
- If fallback exists and primary fails due to missing command/non-zero exit, show the failure and then offer or run fallback depending on policy.

This means the manifest does not need a `mode` field initially. If we later need fully silent/background command execution, add it as a separate advanced capability rather than making it part of the first UX.

## Command Parameters

The current command schema only has static `args`. For autocomplete and safe execution, add parameter metadata.

```ts
type PluginCommandParameter = {
  type: 'string' | 'number' | 'boolean' | 'enum';
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  values?: string[];
};
```

Command arguments can reference parameters with `{name}` placeholders:

```json
{
  "args": ["x", "serve-sim@latest", "--port", "{port}"]
}
```

User input:

```txt
/serve-sim start --port 4000
```

Rendered command:

```txt
bun x serve-sim@latest --port 4000
```

Open questions:

- Should unknown raw args be appended, rejected, or allowed only with `allowExtraArgs: true`?
- Should booleans render as `--flag` or `--flag value`? Prefer per-param `flag` metadata if needed.
- Should command templates support env/cwd interpolation? Useful, but start with args only.

## Backend Architecture

Add a shared plugin command runtime that all surfaces call.

```txt
resolveEffectivePlugins(projectRoot)
  └─ find enabled installed plugin by namespace
      └─ find command by name
          └─ parse parameters
              └─ render command/env/cwd
                  └─ start visible terminal
```

Suggested modules:

```txt
packages/server/src/runtime/plugins/commands/
  resolve.ts      find plugin command definitions
  parse.ts        parse /<plugin> <command> args
  render.ts       render templates and defaults
  execute.ts      terminal execution and fallback handling
  types.ts        runtime result types
```

Suggested API endpoints:

```http
GET  /v1/plugins/commands?project=...
POST /v1/plugins/{plugin}/commands/{command}/run
```

`GET /v1/plugins/commands` returns enabled plugin command namespaces for autocomplete.

`POST /run` accepts parsed args and returns:

```ts
type PluginCommandRunResponse = {
  command: string;
  terminalId: string;
  title: string;
  previewUrl?: string;
};
```

## Frontend Architecture

Extend command suggestions so plugin namespaces participate in slash autocomplete.

Relevant areas to inspect/modify:

- Command suggestion data source in `packages/web-sdk/src/hooks/useCommandSuggestions.ts`
- Command parsing in `packages/web-sdk/src/lib/commands.ts`
- Chat input behavior in `packages/web-sdk/src/components/chat/*`
- Plugin API client types in `packages/web-sdk/src/lib/api-client/plugins.ts`

Desired popup states:

```txt
State 1: slash root
  /help
  /init
  /release-check       recipe
  /serve-sim           plugin commands

State 2: plugin namespace
  /serve-sim start     command
  /serve-sim doctor    command

State 3: plugin command args
  --port               parameter
```

## Agent Awareness

There are two separate features here.

### Phase A: Agents know commands exist

Add enabled plugin commands to agent environment/context, likely as concise metadata:

```txt
Available plugin commands:
- /serve-sim start --port <port>: Start the serve-sim preview server. Opens a terminal.
- /serve-sim doctor: Check simulator dependencies.
```

This lets agents recommend commands to the user or explain how to run them.

Do not dump every command into context blindly if the list grows. Use limits and concise formatting.

### Phase B: Agents can run commands

Add a first-class or loadable tool:

```ts
run_plugin_command({
  plugin: 'serve-sim',
  command: 'start',
  args: { port: '3200' }
})
```

Safety requirements:

- Only enabled installed plugins.
- Show exact rendered command before execution.
- Require normal tool approval for arbitrary process execution.
- Create a visible persistent terminal.
- Fallback should be explicit in the result/log.

Recommended order: build slash/user execution first, then expose the same executor to agents.

## MCP Integration Under Plugins

Plugins already have `mcpServers` metadata, but it should become a real managed capability.

### Goals

A plugin should be able to ship MCP server definitions:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

When the plugin is enabled:

- Its MCP servers are available in the MCP settings/registry.
- The user can start/stop them like other MCP servers.
- Agent tools from those MCP servers become available through existing MCP tooling once connected.

When the plugin is disabled or removed:

- Plugin-provided MCP servers disappear from the effective MCP registry.
- Running plugin MCP servers should be stopped or marked orphaned, depending on current MCP lifecycle behavior.

### Precedence

MCP server definitions should follow plugin/global/project rules.

Suggested precedence:

```txt
lowest
  global plugin MCP servers
  global user MCP config
  project plugin MCP servers
  project user MCP config
highest
```

User config should override plugin defaults because plugins provide defaults, not immutable settings.

### UI treatment

MCP settings should distinguish source:

```txt
MCP Servers
  github         user/project
  serve-sim      plugin: serve-sim
```

Plugin-provided MCP entries should be editable by creating an override, not by mutating plugin files.

### Lifecycle commands

Plugin commands and MCP servers can work together:

```json
{
  "commands": {
    "mcp-start": {
      "label": "Start serve-sim MCP server",
      "command": "bun",
      "args": ["x", "serve-sim-mcp@latest"]
    }
  },
  "mcpServers": {
    "serve-sim": {
      "command": "bun",
      "args": ["x", "serve-sim-mcp@latest"]
    }
  }
}
```

Long term, the MCP registry should own MCP server lifecycle; plugin commands should be for extra helper actions.

## Conflict Rules

### Slash namespace conflicts

Potential conflicts:

- Built-in slash command: `/init`
- Recipe: `/release-check`
- Plugin namespace: `/serve-sim`

Suggested precedence:

```txt
built-in slash commands
recipes
plugin namespaces
```

Autocomplete should show conflicts clearly. When a plugin namespace conflicts with a built-in slash command or recipe, the built-in or recipe wins at execution time.

### Plugin command conflicts

Commands are scoped by plugin, so this is fine:

```txt
/serve-sim start
/playwright start
```

### MCP conflicts

If two enabled plugins contribute the same MCP server name:

- Project plugin overrides global plugin.
- User config overrides plugin config.
- Same-scope plugin conflicts should be marked and not auto-enabled unless deterministic order is accepted.

## Implementation Phases

### Phase 1: Command schema and resolver

- Extend plugin command schema with:
  - `description`
  - `parameters`
  - optional `allowExtraArgs`
- Add command resolver for enabled installed plugins.
- Add command renderer with placeholder substitution.
- Add focused tests for command resolution, disabled plugins, fallbacks, and path/cwd safety.

### Phase 2: Backend execution

- Add server route to list plugin command namespaces.
- Add server route to run one plugin command.
- Start commands in visible terminals using the existing terminal/session infrastructure available to the server, or define the missing bridge if terminal execution is currently client-only.
- Return structured terminal results.

### Phase 3: Slash command parser

- Parse `/<plugin> <command> [args...]` messages before recipe fallback.
- Execute plugin commands through the backend executor.
- Add tests for parsing and conflict precedence.

### Phase 4: Autocomplete UX

- Add plugin namespaces to slash root suggestions.
- Add command-list suggestions after `/<plugin>`.
- Add parameter suggestions after `/<plugin> <command> --`.
- Pressing return on namespace opens/narrows command list, not execution.
- Missing required args should show inline/popup guidance.

### Phase 5: MCP as first-class plugin capability

- Add effective MCP registry that merges plugin MCP definitions and user MCP config.
- Add source metadata: `plugin`, `global`, `project`, `override`.
- Update MCP settings UI to show plugin-provided servers.
- Ensure disabling/removing plugins removes their MCP definitions from the effective registry.
- Add tests for precedence and disabled plugin behavior.

### Phase 6: Agent awareness and tool

- Add concise enabled plugin command metadata to agent context.
- Add optional `run_plugin_command` tool using the same executor.
- Require normal command/tool approvals.
- Add tests for tool allow/deny behavior and terminal result shape.

## Open Questions

- Should plugin command terminal execution happen in the server process, the client app, or through a shared terminal manager API?
- Should fallback commands run automatically or require user confirmation?
- Should chat receive a compact terminal link/result after a user-facing plugin command starts?
- Should plugin commands be allowed to request secrets through parameter metadata?
- Should MCP server env placeholders be validated against available env vars before showing as startable?
- Should recipes be allowed to declare a preferred plugin command dependency, e.g. `requiresCommand: serve-sim.start`?

## Success Criteria

A user installs the `serve-sim` plugin and can:

1. See `/serve-sim` in slash autocomplete.
2. Press return to browse plugin commands.
3. Select `start`, see `--port` suggested, and run `/serve-sim start --port 3200`.
4. See a visible terminal start for the long-running service.
5. Run `/inspect-ios-app`, which can use the plugin-provided `sim_inspector` agent.
6. See plugin-provided MCP servers in MCP settings when the plugin is enabled.
7. Disable the plugin and have its recipes, agents, commands, and MCP servers disappear from effective runtime surfaces.
