# Message Thread Performance Plan

## Context

The web message thread can lag as sessions grow. In otto, the dominant growth pattern is usually **many message parts inside one or a few assistant messages**, not hundreds of top-level messages. That means message-level pagination or virtualization helps initial history loading, but it does not fully solve the worst case: a single assistant turn with hundreds or thousands of tool calls/results, markdown blocks, diffs, terminal chunks, and progress updates.

The current thread path is:

- `packages/web-sdk/src/components/messages/MessageThreadContainer.tsx`
  - Fetches the full session message list with `useMessages(sessionId)`.
- `packages/web-sdk/src/hooks/useMessages.ts`
  - Uses a normal React Query `useQuery` keyed by `['messages', sessionId]`.
- `packages/web-sdk/src/lib/api-client/sessions.ts`
  - Calls `listMessages` without pagination.
- `packages/server/src/routes/session-messages.ts`
  - Returns all messages, then all parts for those message IDs.
- `packages/web-sdk/src/components/messages/MessageThread.tsx`
  - Renders all filtered messages with `.map(...)`.
- `packages/web-sdk/src/components/messages/AssistantMessageGroup.tsx`
  - Renders all visible parts for an assistant message.

The Conductor rewrite post maps well to this problem, but we need to adapt the approach: virtualize not only messages, but eventually the **thread render units** that include assistant parts/activity groups.

## Goals

1. Keep huge agent sessions smooth while streaming.
2. Avoid loading full historical payloads when opening a session.
3. Avoid mounting thousands of message-part DOM nodes.
4. Avoid re-rendering unchanged historical content on each stream delta.
5. Preserve chat UX:
   - initial open at bottom,
   - follow streaming output only when already at bottom,
   - do not yank users while they read older history,
   - preserve scroll position when older history loads,
   - keep retry/branch/compact/tool approval behavior intact.

## Non-goals

- Do not rewrite the entire chat UI at once.
- Do not remove existing compact activity rendering.
- Do not break generated API clients or external consumers without a compatibility path.
- Do not rely on offset pagination for long-term history; use cursors.

## Main bottlenecks

### 1. Full history fetch

`GET /v1/sessions/{id}/messages` currently returns every message and every part. For a long tool-heavy session, one assistant message can contain thousands of parts, so the JSON payload, parsing cost, and React Query cache update cost can become large before React even renders.

### 2. Message-level rendering only

`MessageThread` renders top-level messages. If there are only 20 messages, message-level virtualization alone still mounts a huge assistant message if that assistant message has 2,000 parts.

### 3. Assistant part rendering

`AssistantMessageGroup` sorts parts and builds render items. It then renders each item, including expensive renderers such as markdown, syntax highlighting, diffs, terminal output, read results, and database/search outputs.

### 4. Streaming update frequency

`useSessionStream` updates the `['messages', sessionId]` query as deltas arrive. Even though it updates one message object structurally, the parent thread sees a new array and recomputes derived state.

### 5. Full-thread derived scans

`MessageThread` derives the latest todo snapshot by scanning backward through messages and parts. This should not run across a huge historical thread on every stream tick.

## Recommended architecture

### Phase 1: Low-risk immediate improvements

- Keep the current UI shape.
- Add tighter memoization and targeted derived-state improvements.
- Avoid full-history todo scans on every update.
- Make part-heavy completed assistant messages cheaper by default:
  - keep compact activity grouping,
  - collapse large historical tool activity groups,
  - avoid rendering giant payloads unless expanded.

This phase reduces current lag without changing API contracts.

### Phase 2: Paginated message history

Add a new paginated endpoint instead of changing the existing array response immediately:

```http
GET /v1/sessions/{id}/messages-page?limit=50&before=<createdAt-or-id-cursor>
```

Response:

```ts
interface MessagesPage {
  items: Message[];
  hasMore: boolean;
  nextBefore: number | null;
}
```

Notes:

- Cursor should be based on `(createdAt, id)` or another stable monotonic value.
- Fetch newest page first, return items oldest-to-newest.
- Add/verify indexes:
  - `messages(session_id, created_at)`
  - `message_parts(message_id, index)`
- Keep the legacy `/messages` route for existing clients.

Frontend:

- Add `useMessagesInfinite(sessionId)`.
- Open at the latest page.
- Fetch older pages when the user reaches the top.

This improves initial load but does not fully solve one huge assistant message with many parts.

### Phase 3: Thread render-unit virtualization

Use a virtualizer over flattened thread units rather than only top-level messages.

Possible units:

```ts
type ThreadUnit =
  | { kind: 'session-header' }
  | { kind: 'user-message'; messageId: string }
  | { kind: 'assistant-header'; messageId: string }
  | { kind: 'assistant-part'; messageId: string; partId: string }
  | { kind: 'assistant-activity-group'; messageId: string; groupId: string }
  | { kind: 'assistant-status'; messageId: string }
  | { kind: 'topup-approval' };
```

This is the correct long-term fix for otto because it handles both:

- many top-level messages,
- many parts inside one assistant message.

Implementation notes:

- Use `react-virtuoso` first. Plain `react-virtuoso` is sufficient and avoids the commercial `@virtuoso.dev/message-list` package.
- Flatten only render metadata, not heavy parsed markdown.
- Compute stable keys from message/part IDs.
- Keep row components memoized.
- Use `startReached` to fetch older pages.
- Use `followOutput`/bottom-state callbacks for sticky streaming behavior.

### Phase 4: Part pagination/lazy loading

For very large assistant turns, message pagination is not enough because the latest page may still include all parts for a huge message.

Add optional part loading modes:

```http
GET /v1/sessions/{id}/messages-page?limit=50&parts=summary
GET /v1/messages/{messageId}/parts?limit=200&beforeIndex=<index>
```

Suggested modes:

- `parts=full` for compatibility or small sessions.
- `parts=summary` for thread open:
  - include message metadata,
  - include first/last N parts,
  - include counts by type/tool,
  - include current pending/status parts.
- `parts=none` for list-only views.

The UI can then lazy-load full part ranges when:

- a row enters the viewport,
- the user expands a collapsed tool group,
- the user searches within a session,
- the user jumps to a specific message/part.

### Phase 5: Streaming state isolation

Keep historical pages stable and update the live assistant turn separately.

Preferred shape:

- Historical data: `useInfiniteQuery` pages.
- Live turn data: a small Zustand store or separate React Query key keyed by `messageId`.
- Render layer merges historical units + live units.

This prevents every token/tool delta from rewriting the historical pages array.

### Phase 6: Heavy renderer deferral

For expensive content:

- Render plain markdown/code while a message is streaming; syntax-highlight after completion.
- Collapse large tool outputs by default.
- Render previews for huge diffs/read outputs, with explicit expansion.
- Lazy-mount expensive renderer internals only when expanded and visible.
- Consider replacing `react-syntax-highlighter` in hot paths with a lighter/highly cached highlighter later.

## First implementation target

Start with a safe, incremental change before the larger virtualization refactor:

1. Add this plan doc.
2. Optimize current `MessageThread` derived state:
   - avoid full todo snapshot scans on every stream delta,
   - only scan a bounded suffix of messages/parts as a stopgap.
3. Add a reusable row boundary for thread messages so top-level rows are memoized and ready for virtualization.
4. Then introduce `react-virtuoso` and move from `.map(...)` to virtualized rows.
5. After that, flatten assistant parts into virtualized thread units.

## Verification checklist

- `bun lint`
- `bun run --filter @ottocode/web-sdk typecheck`
- Manual scenarios:
  - open a short session,
  - open a part-heavy session,
  - stream while at bottom,
  - stream while scrolled up,
  - retry last assistant message,
  - compact session,
  - branch from assistant message,
  - approve/reject tool calls,
  - verify scroll-to-bottom button behavior.

## Success criteria

- Opening a large thread does not freeze the UI.
- Streaming updates re-render only the live/visible units.
- DOM node count stays proportional to viewport size, not session size.
- Loading older history preserves scroll position.
- Part-heavy assistant turns remain responsive without requiring users to compact manually.
