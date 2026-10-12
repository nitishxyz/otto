# Compaction continuity

Compaction replaces model-visible history with one canonical session checkpoint, rather than retaining a growing set of summaries and recent turns. The persisted checkpoint remains bounded to 6,000 characters.

The summarizer receives the previous checkpoint plus bounded evidence since that checkpoint:

- User instructions across the available history have reserved space, so long tool loops do not crowd out the original request or intermediate obligations.
- The remaining space favors the most recent execution evidence. Messages and their parts stay in chronological order, including tool calls before their results.
- Long evidence retains both its beginning and end with an explicit omission marker, preserving trailing errors and outcomes rather than only log prefixes.
- The input budget includes the previous checkpoint and section separators. A requested cutoff must exist; later messages are not summarized.

The checkpoint prompt prioritizes original intent, unresolved requests, current execution state, exact continuation identifiers, and the next steps. Completed exploration is shortened first. Each new checkpoint merges and replaces the previous one; omissions are not evidence of completion.

Automatic summarization allows up to 2,400 output tokens to produce the bounded checkpoint. Automatic/manual compaction and handoff share `validateSummary`: output with `length`, `error`, or `content-filter` finish reasons, empty output, and summaries shorter than 50 trimmed characters are rejected. Failed automatic summarization may fall back to pruning tool results without replacing the checkpoint; manual compaction and handoff do not install invalid summaries.

The persisted checkpoint distinguishes the summary display message (`compactionMessageId`) from the last message whose evidence it covers (`compactionThroughMessageId`). History resumes after the evidence boundary, not after a later summary message, so intervening queued/user turns remain visible. Manual snapshot compaction requires an explicit evidence boundary. Summary part content, tool-pruning markers, and session checkpoint identities commit together in one transaction; branch copying carries and remaps checkpoint identities transactionally.

The streamed content writer retains unacknowledged write sequences, replays worker failures in-process, and rejects failed durability barriers. This is not restart recovery: in-memory pending writes and tool-finalization retries do not survive daemon death.

This is still lossy summarization, not an archive. Full messages remain persisted for history access, and durable files remain the source of truth for implementation details. Model-generated handoff quality still depends on the summarizing model.

Regression coverage: `tests/compaction-checkpoint.test.ts`, `tests/harness-persist-checkpoint.test.ts`, `tests/harness-compaction-dispatch-boundary.test.ts`, `tests/harness-loop-compaction.test.ts`, and `tests/harness-persist-writer.test.ts`. See the [Harness reliability roadmap](./plans/harness-reliability-roadmap.md) for the recorded verification snapshot and unresolved acceptance blockers.
