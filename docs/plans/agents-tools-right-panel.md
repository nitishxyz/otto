# Agents & Tools Right Panel Plan

## Goal

Build a right-side panel for managing agents and their tools from the web/desktop UI.

Users should be able to:

- View all built-in and custom agents
- Select an agent and inspect its prompt, model/provider overrides, and enabled tools
- Enable or disable tools for an agent
- Create new custom agents
- Edit agent prompts
- Duplicate existing agents
- Reset built-in agent overrides
- Delete custom agents
- Set the default agent

## Current State

The project already has most of the runtime concepts needed for this feature.

### Existing agent config support

Agent configuration is represented by:

```ts
type AgentConfigEntry = {
  tools?: string[];
  appendTools?: string[];
  prompt?: string;
  provider?: string;
  model?: string;
};
```

Agent configuration is loaded from:

- Local project config: `.otto/agents.json`
- Global config: `~/.config/otto/agents.json`
- Local prompt files under `.otto/agents/`
- Global prompt files under the global agents directory
- Embedded fallback prompts for built-in agents

Relevant files:

- `packages/server/src/runtime/agent/registry.ts`
- `packages/server/src/runtime/agent/registry-prompts.ts`
- `packages/server/src/routes/config/agents.ts`

### Existing API support

Currently there is a lightweight route:

```http
GET /v1/config/agents
```

It returns only:

```ts
{
  agents: string[];
  default: string;
}
```

This is enough for simple selection but not enough for full editing.

### Existing tool support

Tools are discovered through:

```ts
discoverProjectTools(projectRoot, undefined, cfg.skills)
```

Relevant files:

- `packages/sdk/src/core/src/tools/loader.ts`
- `packages/server/src/runtime/agent/runner-setup-tools.ts`

At runtime, agent tools are filtered by:

```ts
buildAllowedTools(...)
```

This means the UI can safely persist tool names into agent config, and the runner already knows how to honor them.

### Existing right-sidebar architecture

The web/desktop apps already support multiple right-side panels:

- Git
- Session files
- File browser
- Tunnel
- MCP
- Skills
- Settings

Relevant files:

- `apps/web/src/components/layout/AppLayout.tsx`
- `apps/desktop/src/components/workspace/DesktopAppLayout.tsx`
- `packages/web-sdk/src/stores/*Store.ts`
- `packages/web-sdk/src/components/*/*Sidebar.tsx`

The agents panel should follow these same patterns.

## UX Proposal

Add a new right sidebar tab named **Agents**.

Suggested icon: `Bot`, `Users`, or `Sparkles` from `lucide-react`.

### Panel layout

```txt
Agents
────────────────────
[+ New Agent]

Default: general

Agents
  ● build
  ○ general
  ○ plan
  ○ research
  ○ reviewer custom
  ○ docs custom

────────────────────
Selected: build

[Name] build
[Provider override] optional
[Model override] optional

Prompt
[textarea / edit button]

Tools
[Search tools...]

Core
  [x] finish              locked
  [x] progress_update     locked
  [x] update_todos

Filesystem
  [x] read
  [x] write
  [x] ls
  [ ] tree
  [x] glob
  [x] ripgrep

Git
  [x] git_status
  [ ] git_diff
  [ ] git_commit

Shell
  [x] shell
  [ ] terminal

Web
  [x] websearch

MCP
  [ ] github__create_issue
  [ ] linear__list_issues

Custom
  [ ] my_custom_tool

[Reset] [Save]
```

### UX details

- Built-in agents should be clearly labeled.
- Custom agents should be clearly labeled.
- Built-in agents cannot be deleted, only reset to defaults.
- Custom agents can be deleted.
- `finish` should always be enabled and locked.
- `progress_update` should probably be enabled and locked as well.
- Disabling important tools should be allowed, but destructive/important tools should have clear labeling.
- MCP tools should indicate that availability depends on the MCP server being connected.
- Unsaved changes should show a dirty state and confirm before closing/switching agents.

## Backend/API Plan

Add richer config routes for agent/tool management.

These routes should live under `packages/server/src/routes/config/`.

A reasonable split:

```txt
packages/server/src/routes/config/agents.ts
packages/server/src/routes/config/tools.ts
```

Or keep agent-specific routes in the existing `agents.ts` file if it remains small.

### Data models

#### Agent detail response

```ts
type AgentDetail = {
  name: string;
  builtin: boolean;
  source: 'builtin' | 'local' | 'global' | 'embedded';
  prompt: string;
  promptSource: string;
  tools: string[];
  defaultTools: string[];
  appendTools?: string[];
  provider?: string;
  model?: string;
  editable: boolean;
  hasLocalOverride: boolean;
  hasGlobalOverride: boolean;
};
```

#### Tool detail response

```ts
type ToolDetail = {
  name: string;
  description?: string;
  category:
    | 'core'
    | 'filesystem'
    | 'search'
    | 'editing'
    | 'shell'
    | 'git'
    | 'web'
    | 'mcp'
    | 'skill'
    | 'custom'
    | 'research'
    | 'other';
  source: 'builtin' | 'mcp' | 'custom' | 'skill';
  required?: boolean;
};
```

### Route: list full agent details

```http
GET /v1/config/agents/details?scope=local
```

Returns:

```ts
{
  agents: AgentDetail[];
  default: string;
}
```

Implementation notes:

- Use `discoverAllAgents(...)` to collect agent names.
- Use `resolveAgentConfig(...)` to resolve each agent.
- Use `loadAgentsConfig(...)` to determine overrides.
- Extend `resolveAgentPrompt(...)` or add a helper to expose prompt source.
- Include built-in defaults via `defaultToolsForAgent(...)`.

### Route: get one agent

```http
GET /v1/config/agents/:agent
```

Returns:

```ts
{
  agent: AgentDetail;
}
```

### Route: create/update agent

```http
PUT /v1/config/agents/:agent
```

Body:

```ts
{
  prompt?: string;
  tools?: string[];
  appendTools?: string[];
  provider?: string;
  model?: string;
  scope?: 'local' | 'global';
}
```

Behavior:

- For local scope, write to `.otto/agents.json`.
- For global scope, write to `~/.config/otto/agents.json`.
- Create parent directories if needed.
- Validate agent names.
- Validate provider/model fields when present.
- Validate tools against discovered tools where possible.
- Always ensure required tools remain available.

### Route: delete/reset agent override

```http
DELETE /v1/config/agents/:agent?scope=local
```

Behavior:

- If the agent is built-in, remove the local/global override and restore default behavior.
- If the agent is custom, remove it from `agents.json`.
- Do not delete prompt files by default.
- Optionally support `?deletePrompt=true` later.

### Route: list tools

```http
GET /v1/config/tools
```

Returns:

```ts
{
  tools: ToolDetail[];
}
```

Implementation notes:

- Use `discoverProjectTools(...)`.
- Classify built-in tools by known names.
- Classify MCP tools by naming convention and MCP metadata where available.
- Classify plugin/custom tools separately if possible.
- Mark `finish` and `progress_update` as required.

### Route: set default agent

Use the existing defaults route rather than creating a new route:

```http
PATCH /v1/config/defaults
```

Body:

```ts
{
  agent: string;
  scope?: 'local' | 'global';
}
```

## Frontend Plan

Implement the panel in `@ottocode/web-sdk` so both web and desktop apps can reuse it.

### New files

```txt
packages/web-sdk/src/lib/api-client/agents.ts
packages/web-sdk/src/hooks/useAgents.ts
packages/web-sdk/src/stores/agentsStore.ts
packages/web-sdk/src/components/agents/AgentsSidebar.tsx
packages/web-sdk/src/components/agents/AgentsSidebarToggle.tsx
packages/web-sdk/src/components/agents/AgentEditor.tsx
packages/web-sdk/src/components/agents/ToolToggleList.tsx
packages/web-sdk/src/components/agents/index.ts
```

Depending on existing API client conventions, the API methods may instead be added to:

```txt
packages/web-sdk/src/lib/api-client/config.ts
```

### Hooks

Add hooks similar to existing config/MCP/skills hooks:

```ts
useAgentDetails()
useAgent(agentName)
useTools()
useUpdateAgent()
useDeleteAgent()
useCreateAgent()
```

Suggested query keys:

```ts
['config']
['agents']
['agents', agentName]
['tools']
```

Mutation success should invalidate relevant config/agent/tool queries.

### Store

Add a Zustand store following the existing sidebar store pattern.

```ts
type AgentsStore = {
  isExpanded: boolean;
  selectedAgent?: string;
  toggleSidebar: () => void;
  expandSidebar: () => void;
  collapseSidebar: () => void;
  selectAgent: (agent: string) => void;
};
```

When opening Agents, collapse other right-side panels:

- Git
- Session files
- Settings
- Tunnel
- File browser
- MCP
- Skills

### Components

#### `AgentsSidebar`

Responsibilities:

- Fetch agent details and tools.
- Render agent list.
- Track selected agent.
- Render `AgentEditor`.
- Handle loading/error/empty states.

#### `AgentsSidebarToggle`

Responsibilities:

- Render right rail toggle button.
- Show active state when open.
- Use an appropriate icon.
- Include shortcut badge later if a shortcut is added.

#### `AgentEditor`

Responsibilities:

- Edit selected agent fields.
- Track dirty state.
- Save/reset/delete actions.
- Provider/model overrides.
- Prompt editing.
- Tool selection.

#### `ToolToggleList`

Responsibilities:

- Search tools.
- Group by category.
- Toggle enabled/disabled state.
- Show locked tools.
- Show source/category labels.

## App Integration Plan

Update both app layouts.

### Web app

File:

```txt
apps/web/src/components/layout/AppLayout.tsx
```

Add imports:

```ts
AgentsSidebar
AgentsSidebarToggle
useAgentsStore
```

Update:

- `agentsExpanded` state selector
- `anyRightPanelOpen`
- `activeRightPanelWidth`
- right panel contents
- right rail toggles

Suggested toggle placement:

```tsx
<MCPSidebarToggle />
<SkillsSidebarToggle />
<AgentsSidebarToggle />
<SettingsSidebarToggle />
```

### Desktop app

File:

```txt
apps/desktop/src/components/workspace/DesktopAppLayout.tsx
```

Apply the same integration as the web app.

## OpenAPI/API Client Generation

After adding backend routes and OpenAPI metadata, regenerate the API client:

```bash
bun run --filter @ottocode/api generate
```

Then update the web SDK API client wrapper to expose the generated methods.

## Validation Rules

### Agent names

Agent names should be validated before writing to disk.

Recommended rule:

```txt
^[a-zA-Z0-9_-]+$
```

Reject names with:

- `/`
- `\`
- `..`
- leading/trailing whitespace
- empty strings

### Required tools

Required tools:

- `finish`
- likely `progress_update`

These should be locked in the UI and enforced on the backend.

### Destructive tools

Label these as higher-risk:

- `shell`
- `terminal`
- `write`
- `apply_patch`
- `git_commit`

The UI does not need to block them, but it should make their capability clear.

### Unknown tools

Prefer validating against discovered tools.

However, for MCP and custom tool workflows, it may be useful to preserve unknown existing tool names from config and show them as unavailable/stale rather than silently deleting them.

## Prompt Storage Strategy

There are two possible approaches.

### Simple MVP: inline prompts

Store prompt text directly in `.otto/agents.json`:

```json
{
  "reviewer": {
    "prompt": "You are a careful code reviewer...",
    "tools": ["read", "ripgrep", "update_todos"]
  }
}
```

Pros:

- Fastest to implement
- One file to update

Cons:

- Large prompts make JSON hard to read
- Less convenient to version/review

### Recommended: prompt files

Write prompts to:

```txt
.otto/agents/<agent>/agent.md
```

Then store a reference in `.otto/agents.json`:

```json
{
  "reviewer": {
    "prompt": ".otto/agents/reviewer/agent.md",
    "tools": ["read", "ripgrep", "update_todos"]
  }
}
```

Pros:

- Prompts are readable and versionable
- Works with existing prompt resolution logic
- Easier for users to edit manually

Cons:

- Slightly more backend work

Recommendation: use prompt files for create/edit prompt flows.

## MVP Phases

### Phase 1: Read-only panel

Goal: show agents and tools without editing.

Tasks:

- Add `GET /v1/config/agents/details`.
- Add `GET /v1/config/tools`.
- Add generated API client methods.
- Add `useAgents` hooks.
- Add `agentsStore`.
- Add `AgentsSidebar` and `AgentsSidebarToggle`.
- Integrate into web and desktop right sidebars.
- Display selected agent prompt/tools/provider/model.

This phase validates the UX with minimal risk.

### Phase 2: Enable/disable tools

Goal: allow tool toggles to persist to local config.

Tasks:

- Add `PUT /v1/config/agents/:agent`.
- Add backend config writing helpers.
- Add tool toggle UI.
- Save selected tools to `.otto/agents.json`.
- Enforce required tools.
- Invalidate config/agent queries after save.
- Add dirty-state handling.

### Phase 3: Prompt editing

Goal: edit prompts from the panel.

Tasks:

- Add prompt editor in `AgentEditor`.
- Save prompts to `.otto/agents/<agent>/agent.md`.
- Store prompt file reference in `agents.json`.
- Support reset for built-in prompts.
- Show prompt source path.

### Phase 4: Create, duplicate, delete, reset

Goal: full agent lifecycle management.

Tasks:

- Add new-agent flow.
- Add duplicate-agent flow.
- Add delete for custom agents.
- Add reset override for built-in agents.
- Add local/global scope selector.

### Phase 5: Polish

Goal: improve discoverability and safety.

Tasks:

- Search/filter agents.
- Search/filter tools.
- Better tool category labels.
- Warnings for destructive tools.
- Keyboard shortcut, if desired.
- Update docs in `docs/agents-tools.md`.
- Add tests.

## Recommended First PR

Start with Phase 1 only:

- Read-only backend routes
- Read-only panel UI
- Right sidebar integration

This keeps the first PR small and validates layout/data shape before introducing config writes.

Then implement Phase 2 as the first mutation PR.

## Likely Files To Touch

### Backend

```txt
packages/server/src/routes/config/agents.ts
packages/server/src/routes/config/tools.ts
packages/server/src/routes/config/index.ts
packages/server/src/runtime/agent/registry.ts
packages/server/src/runtime/agent/registry-prompts.ts
packages/api/openapi.json
```

### Frontend SDK

```txt
packages/web-sdk/src/lib/api-client/config.ts
packages/web-sdk/src/lib/api-client/index.ts
packages/web-sdk/src/hooks/useAgents.ts
packages/web-sdk/src/hooks/index.ts
packages/web-sdk/src/stores/agentsStore.ts
packages/web-sdk/src/stores/index.ts
packages/web-sdk/src/components/agents/AgentsSidebar.tsx
packages/web-sdk/src/components/agents/AgentsSidebarToggle.tsx
packages/web-sdk/src/components/agents/AgentEditor.tsx
packages/web-sdk/src/components/agents/ToolToggleList.tsx
packages/web-sdk/src/components/agents/index.ts
packages/web-sdk/src/components/index.ts
```

### Apps

```txt
apps/web/src/components/layout/AppLayout.tsx
apps/desktop/src/components/workspace/DesktopAppLayout.tsx
```

### Tests and docs

```txt
tests/agents.test.ts
tests/agents-prompts.test.ts
tests/tools.test.ts
docs/agents-tools.md
```

## Test Plan

### Backend tests

- Lists built-in agents with resolved default tools.
- Lists custom agents from `.otto/agents.json`.
- Resolves prompt source correctly.
- Lists discovered tools with categories.
- Saves agent tool changes to local config.
- Rejects invalid agent names.
- Preserves required tools.
- Resets built-in overrides without deleting built-in agents.

### Frontend tests

- Agents panel renders loading, error, and populated states.
- Selecting an agent updates the editor.
- Tool toggles update dirty state.
- Save calls mutation and clears dirty state.
- Reset/delete buttons show correct behavior for built-in vs custom agents.

### Manual verification

Run:

```bash
bun lint
bun test
bun run --filter @ottocode/api generate
```

Then manually verify:

- Web app right sidebar opens Agents panel.
- Desktop app right sidebar opens Agents panel.
- Built-in agents are visible.
- Custom agents from `.otto/agents.json` are visible.
- Tool toggles persist and affect newly started sessions.
- Prompt edits persist and affect newly started sessions.
