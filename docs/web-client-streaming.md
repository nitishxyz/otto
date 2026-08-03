# Web Client Streaming & Optimistic Updates

How the web/desktop client (via `@ottocode/web-sdk`) keeps sessions fast and
seamless, especially against a remote daemon.

## Session stream engine

`packages/web-sdk/src/hooks/sessionStreamEngine.ts`

- Hook-free `startSessionStreamEngine({ sessionId, queryClient, isActive })`
  applies a session's SSE events (message/reasoning/tool deltas, queue and
  session updates, shell jobs) to the React Query caches.
- Query keys are captured at engine start so a background engine keeps writing
  to the project scope it was started for.
- Global single-session UI (viewer tabs follow-activity, tool approvals,
  secure-input prompts) is gated on `isActive()` so only the actively viewed
  session drives it. Cache updates (messages, files, queue state) always apply.

## Stream manager (keep-alive across session switches)

`packages/web-sdk/src/hooks/sessionStreamManager.ts`

- `acquireActiveSessionStream(sessionId, queryClient)` starts or reuses an
  engine and marks it actively viewed; `useSessionStream` is now a thin wrapper
  that also syncs pending approvals/secure inputs from the server.
- On release the engine is **not** torn down: it stays attached while the
  session's turn is still running (per cached queue state), so switching
  sessions mid-stream loses no chunks. Idle engines are retained for 5 minutes
  (max 4) and swept every 30s.
- Transport is unchanged: all engines share the one multiplexed
  `/v1/events/project` SSE connection (`lib/event-stream.ts`).

## Optimistic message sending

`packages/web-sdk/src/hooks/useMessages.ts`

- `useSendMessage` inserts an optimistic user message (`optimistic: 'sending'`,
  `status: 'pending'`) into the messages cache in `onMutate`, so the message
  appears instantly even on slow remote daemons. `UserMessageGroup` renders a
  `StableSpinner` "Sending" chip while pending.
- If the session's stream is already running, the message is marked
  `optimistic: 'queued'` instead: it is hidden from the thread and an
  optimistic entry is added to the queue-state cache, so `InputQueueBar` shows
  it immediately (with a spinner instead of queue actions until confirmed).
- On success the optimistic entry settles (`status: 'complete'`, queue entry
  swapped to the server-assigned assistant message id). On error it is removed
  and the typed text plus attachments are restored to the input
  (`useQueueStore.setPendingRestore`).
- Dedupe: the engine drops optimistic copies when the matching server user
  message arrives via `message.created`; refetches re-append unconfirmed
  optimistic entries (`mergeOptimisticMessages`) with a 2-minute TTL safety
  net so a background invalidation cannot make a just-sent message vanish.

## Caching & session switching

- Messages queries keep a 30-minute `gcTime`, so returning to a recently
  viewed session renders instantly from cache while a background refetch
  reconciles.
- `SessionItem` prefetches messages and queue state on hover/focus
  (`prefetchSessionMessages`), making session switches feel immediate.
