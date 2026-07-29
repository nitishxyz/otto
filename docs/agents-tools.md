# Agents & Tools

[← Back to README](../README.md) · [Docs Index](./index.md)

---

## Browser tool

The loadable `browser` tool opens pages in Otto's preview and supports an
inspect-and-act loop for agents.

Navigation:

- `open` shows a URL in the preview (`newTab: true` creates a dedicated agent
  tab, `kind: "simulator"` targets the serve-sim preview tab).
- `navigate`, `back`, `forward`, and `reload` wait for the next document to
  finish loading and return the settled URL, title, and ready state.
- `stop` aborts an in-flight load.

Inspection:

| Action | Returns |
|---|---|
| `snapshot` | Visible text, interactive elements with stable `@e1` references, and viewport/scroll state |
| `screenshot` | The rendered page as an image attached to the tool result for vision models |
| `html` | Live DOM markup for the document or a selector (`maxLength` caps the payload) |
| `find` | Elements whose own text or opening tag match `query`, with refs and markup snippets |
| `console` | Console output and page errors captured since the document loaded (`level`, `limit`) |
| `network` | `fetch`, `XHR`, and resource requests with status and duration (`query`, `limit`) |
| `evaluate` | The serializable value of a JavaScript snippet |

Interaction:

- `click`, `hover`, `type`, `press`, and `scroll` act on a CSS selector or a
  snapshot reference such as `@e3`. `type` also selects `<select>` options by
  value or label.
- `wait_for` polls until a selector becomes visible or `text` appears, up to
  `timeoutMs` (default 5000).

Console and network entries come from a small recorder that the desktop webview
injects before page scripts run, so activity from the first paint onward is
captured. Web clients inject the same recorder on demand, so they only see
activity from the first `console`/`network` call onward.

The desktop app renders pages in a native top-level webview, so sites that deny
iframe embedding with `X-Frame-Options` or CSP still work, and screenshots are
captured from the real webview (macOS today). In a normal web client, arbitrary
cross-origin pages remain display-only because browser same-origin rules prevent
DOM inspection, and `screenshot` is unavailable. Full cross-origin automation
should therefore use the desktop app.

Page commands are queued until a preview tab connects. If nothing is connected,
the tool reports that no preview is attached instead of silently timing out.

Desktop browser tabs retain the native webview while navigating, preserving
cookies, storage, JavaScript state, and the webview's real history. Page-driven
and single-page-app navigation synchronize back to Otto's address bar; toolbar
back, forward, reload, and stop controls operate on that same native webview.

## Built-in agents

The server runtime currently exports these built-in presets:

- `build`
- `plan`
- `general`
- `research`

All of them also include the control tools `progress_update`, `finish`, and `skill`.

### `build`

Default implementation agent for code changes.

Common tools:

- `read`, `write`, `ls`, `tree`, `shell`
- `glob`, `search`
- `git_status`, `terminal`
- `apply_patch`, `update_todos`, `websearch`

### `plan`

Planning/analysis agent.

Common tools:

- `read`, `ls`, `tree`
- `search`
- `update_todos`, `websearch`

### `general`

Broad mixed-purpose agent.

Common tools:

- `read`, `write`, `ls`, `tree`, `shell`
- `glob`, `search`
- `update_todos`, `websearch`

### `research`

Research-oriented agent that can inspect prior sessions and related context.

Common tools:

- `read`, `ls`, `tree`, `search`, `websearch`
- `update_todos`
- `query_sessions`, `query_messages`, `get_session_context`
- `search_history`, `get_parent_session`, `present_action`

---

## Built-in tools

The lists below describe the overall built-in tool surface. Individual agents
only receive the subset defined by their preset or config overrides.

### File system

| Tool | Description |
|---|---|
| `read` | Read files, optionally by line range |
| `write` | Write or create a file |
| `ls` | List a directory |
| `tree` | Render a directory tree |
| `pwd` | Return the current working directory |
| `cd` | Change the current working directory for the tool runtime |
| `glob` | Find files by glob pattern |

### Search and web

| Tool | Description |
|---|---|
| `search` | Fast indexed regex/code search |
| `websearch` | Web search or URL fetch |

### Editing

| Tool | Description |
|---|---|
| `apply_patch` | Apply diff/enveloped patches |

### Shell and runtime

| Tool | Description |
|---|---|
| `shell` | One-shot non-interactive shell command execution |
| `terminal` | Persistent terminal lifecycle management |

### Git

| Tool | Description |
|---|---|
| `git_status` | Working tree summary |
| `git_diff` | Diff output |
| `git_commit` | Commit creation |

### Agent control

| Tool | Description |
|---|---|
| `update_todos` | Track a visible task list |
| `progress_update` | Emit short status/progress updates |
| `finish` | Signal task completion |
| `skill` | Load specialized instructions from a skill bundle |

### Research helpers

| Tool | Description |
|---|---|
| `query_sessions` | Search sessions |
| `query_messages` | Search messages |
| `get_session_context` | Load a session context snapshot |
| `search_history` | Search historical activity |
| `get_parent_session` | Resolve parent session linkage |
| `present_action` | Present research findings/action links |

---

## Agent overrides

Use either:

- `.otto/agents.json`
- `~/.config/otto/agents.json`

Example:

```json
{
  "build": {
    "appendTools": ["git_diff", "glob"]
  },
  "reviewer": {
    "tools": ["read", "ls", "tree", "search", "update_todos"],
    "prompt": ".otto/agents/reviewer.md"
  }
}
```

Prompt files are typically stored at:

- `.otto/agents/<name>.md`
- `.otto/agents/<name>.txt`
- `~/.config/otto/agents/<name>.md`
- `~/.config/otto/agents/<name>.txt`

## Custom tools

Project or global custom tools are discovered from plugin folders:

- `.otto/tools/<tool-name>/tool.js`
- `.otto/tools/<tool-name>/tool.mjs`
- `~/.config/otto/tools/<tool-name>/tool.js`
- `~/.config/otto/tools/<tool-name>/tool.mjs`

See [Customization](./customization.md) for the plugin descriptor format.

## MCP tools

Running MCP servers expose tools named like `server__tool` and make them available at runtime.

These tools are separate from the built-in per-agent tool presets and come from
the connected MCP server itself.

Examples:

- `github__create_issue`
- `linear__list_issues`
- `helius__getBalance`

See [MCP Servers](./mcp.md) for transport and OAuth setup.

## Skills

The `skill` tool loads markdown instruction bundles on demand.

Skill sources:

- built-in bundled skills
- `.otto/skills/`
- `.agents/skills/`
- `~/.config/otto/skills/`
- `~/.agents/skills/`

You can inspect available skills with:

```bash
otto skills
```
