# Tool Activity Viewer Plan

## Goal

Add an optional viewer mode that follows file-related tool calls and shows what the agent is reading or changing without removing the existing tool cards from the message thread.

The first milestone should focus on `read`, because it is low risk and immediately useful: it shows which file the agent is looking at and which line range is relevant. After that works, reuse the same plumbing for `write` and `apply_patch` previews.

## User Experience

Add a small toggle button using a `Target` or `Crosshair` icon.

Suggested label: **Follow tool activity**.

When enabled:

- File-related tool calls open or update tabs in the viewer.
- The message thread continues to show streamed tool calls normally.
- Viewer tabs are lightweight projections of tool activity, not replacements for the message thread.
- Read-only tools can show real file content immediately.
- Write tools should show proposed/live previews while streaming, then finalize after success.

When disabled:

- Existing behavior remains unchanged.
- Tool cards still render in the message thread.
- Viewer tabs only open when the user explicitly opens them.

## Relevant Existing Code

- Stream handling: `packages/web-sdk/src/hooks/useSessionStream.ts`
  - Handles `tool.call`, `tool.delta`, and `tool.result`.
  - Already accumulates streamed tool input/output for message rendering.
- Viewer tab state: `packages/web-sdk/src/stores/viewerTabsStore.ts`
  - Supports `file`, `git-diff`, `session-file-diff`, and `skill-file` tabs.
- Viewer shell: `packages/web-sdk/src/components/workspace/ViewerTabs.tsx`
- File viewer: `packages/web-sdk/src/components/file-browser/FileViewerPanel.tsx`
- Session file diffs: `packages/web-sdk/src/components/session-files/SessionFilesDiffPanel.tsx`
- Tool renderers:
  - `packages/web-sdk/src/components/messages/renderers/ReadRenderer.tsx`
  - `packages/web-sdk/src/components/messages/renderers/WriteRenderer.tsx`
  - `packages/web-sdk/src/components/messages/renderers/ApplyPatchRenderer.tsx`

## Proposed State Model

Extend the viewer tab store with follow-mode state and tool-focused tab metadata.

Example shape:

```ts
interface ToolActivityHighlight {
	startLine?: number;
	endLine?: number;
	reason: 'read' | 'write' | 'apply_patch';
	callId?: string;
	status: 'streaming' | 'success' | 'error';
}
```

Add store actions along these lines:

```ts
toggleFollowToolActivity(): void;
setFollowToolActivity(enabled: boolean): void;
openToolReadTab(path: string, highlight: ToolActivityHighlight): void;
openToolPreviewTab(args: ToolPreviewTabArgs): void;
finalizeToolPreview(callId: string, result: unknown): void;
clearToolHighlight(callId: string): void;
```

For the `read` MVP, avoid a new tab type if possible. Start by extending `file` tabs with optional highlight metadata:

```ts
{
	id: `file:${path}`,
	type: 'file',
	title,
	path,
	highlight?: ToolActivityHighlight,
}
```

If that becomes awkward for write previews, add a separate `tool-preview` tab type later.

## Milestone 1: `read` Tool Follow Mode

### Behavior

When `Follow tool activity` is enabled and a `read` tool call occurs:

1. Parse the tool args from `tool.call`, `tool.delta`, or `tool.result`.
2. Resolve the file path from `args.path`.
3. Resolve line range from `args.startLine` and `args.endLine` when present.
4. Open or update a viewer file tab for that path.
5. Focus the tab.
6. Scroll to the range and highlight it.
7. Show a subtle status badge such as:
   - `Reading file`
   - `Reading lines 42–80`

The message thread remains unchanged and continues to show the `read` tool card.

### Implementation Notes

- Hook into `useSessionStream.ts` where `tool.call`, `tool.delta`, and `tool.result` are processed.
- Add a small helper to normalize tool args:

```ts
function getToolArgs(payload: Record<string, unknown> | undefined): Record<string, unknown> | null
```

- Only trigger viewer updates for `name === 'read'`.
- Guard on follow-mode state to avoid surprising users.
- For streamed args, update only when there is a parseable path.
- If no line range is provided, open the file without a line highlight.

### File Viewer Changes

`FileViewerPanel` should accept/use highlight metadata from the tab store:

- Scroll to `startLine` when a highlighted range appears.
- Highlight lines from `startLine` to `endLine`.
- If only `startLine` exists, highlight one line.
- If the file is large or still loading, apply the scroll after content loads.

### Acceptance Criteria

- Toggle is off by default or uses a persisted preference if product wants that.
- Turning it on causes `read` calls to open the file in the viewer.
- `startLine` / `endLine` ranges are highlighted.
- The original read renderer in the message thread is unchanged.
- No viewer tab opens when toggle is off.
- Multiple reads to the same file update the same tab highlight.

## Milestone 2: `write` Tool Preview

### Behavior

When follow mode is enabled and a `write` tool call streams:

1. Open a preview tab for the target path once `args.path` is known.
2. Show the incoming/proposed file content from `args.content` as it streams.
3. Mark the tab as `Proposed write` or `Writing`.
4. Do not treat the preview as committed until the tool succeeds.
5. On successful `tool.result`, refresh the real file tab or replace preview with final file content.
6. On error, keep the preview marked failed or close it depending on UX preference.

### Why Preview First

A streamed `write` can fail due to validation, permissions, path restrictions, or interrupted execution. Showing it as a proposal avoids lying about the actual filesystem state.

### Implementation Notes

- Add a `tool-preview` viewer tab type if `file` tabs cannot represent unsaved/proposed content cleanly.
- Preview tab fields should include:

```ts
{
	id: `tool-preview:${callId}:${path}`,
	type: 'tool-preview',
	title,
	path,
	toolName: 'write',
	callId,
	content,
	status: 'streaming' | 'success' | 'error',
}
```

- If the `write` result includes an artifact or final content, use that to finalize.
- Otherwise invalidate/refetch file content after success.

### Acceptance Criteria

- Streamed write content appears in the viewer while the tool call is still in progress.
- Failed writes do not appear as committed file content.
- Successful writes refresh to real file content.
- Message thread write renderer remains unchanged.

## Milestone 3: `apply_patch` Live Diff Preview

### Behavior

When follow mode is enabled and `apply_patch` streams:

1. Parse streamed patch text from tool input.
2. Detect file directives as soon as they appear:
   - `*** Update File: path`
   - `*** Add File: path`
   - `*** Delete File: path`
   - unified diff markers like `+++ b/path`
3. Open or update one preview tab per affected file.
4. Show the current patch/diff for each file while streaming.
5. When another file directive appears, add another viewer tab for that file.
6. On success, finalize tabs to session-file diffs or refreshed real file views.
7. On failure, mark preview tabs as failed and keep the streamed patch visible for debugging.

### Implementation Notes

- Reuse existing patch parsing helpers where possible. The ACP package already has patch path extraction logic in `packages/acp/src/tools.ts`, but web-sdk should avoid importing across package boundaries unless the dependency graph allows it.
- Prefer a small local parser in web-sdk for UI-only path detection.
- Do not attempt to fully apply patches in the browser for MVP.
- Show live diff text first; simulate final file content later only if needed.
- For success finalization, prefer existing session-file diff flows if the server records operations for the session.

### Preview Strategy

Use `tool-preview` tabs with per-file patch slices:

```ts
{
	id: `tool-preview:${callId}:${path}`,
	type: 'tool-preview',
	title,
	path,
	toolName: 'apply_patch',
	callId,
	patch,
	status: 'streaming' | 'success' | 'error',
}
```

For `apply_patch`, the viewer should make it visually clear that the content is a **patch preview**, not the final file.

### Acceptance Criteria

- A patch touching one file opens one preview tab.
- A patch touching multiple files opens/updates multiple preview tabs.
- Preview updates while tool input streams.
- Failed patch calls remain visibly marked as failed.
- Successful patch calls finalize to actual file/diff state.
- Message thread apply-patch renderer remains unchanged.

## Event Handling Plan

Add a small dispatcher inside `useSessionStream.ts` after payload normalization:

```ts
function handleToolActivityViewerEvent(eventType: string, payload: Record<string, unknown> | undefined) {
	if (!useViewerTabsStore.getState().followToolActivity) return;

	const name = getToolEventName(payload);
	if (name === 'read') handleReadToolActivity(eventType, payload);
	if (name === 'write') handleWriteToolActivity(eventType, payload);
	if (name === 'apply_patch') handleApplyPatchToolActivity(eventType, payload);
}
```

Call it for:

- `tool.call`
- `tool.delta`
- `tool.result`
- `error`

Keep this code separate from message-cache updates so viewer behavior cannot break the message thread.

## UI Placement

Good locations for the toggle:

1. Viewer header / tab strip, if viewer is visible.
2. Chat header/session header, so it can be enabled before any viewer tab exists.
3. Near existing sidebar/tool toggles if that is where global workspace controls live.

Recommendation: put it in the session/header control area so users can enable it before the first tool call opens a viewer tab.

## Risks and Guardrails

- **Streaming args may not be valid JSON yet.** Use best-effort parsing and wait until enough input exists.
- **Patch previews can be wrong if we simulate too much.** MVP should show patch text/diff, not pretend to be final file content.
- **Auto-focusing can be annoying.** Consider only auto-focus while follow mode is enabled, and maybe avoid stealing focus if the user manually selected another tab recently.
- **Large files can be expensive.** Read MVP should rely on existing file loading behavior and only add highlighting/scrolling.
- **Failed writes/patches must not look committed.** Use explicit `streaming`, `success`, and `error` badges.

## Suggested Rollout

1. Add toggle state and UI.
2. Implement `read` tab opening + line highlight.
3. Add tests or targeted component coverage for store actions and parsing helpers.
4. Ship/read-dogfood the MVP.
5. Add `write` preview tabs.
6. Add `apply_patch` live diff tabs.
7. Improve multi-file patch UX and finalization behavior.
