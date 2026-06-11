# Otto Orchestrator Plan

Status: implemented (June 2026). Phases 1–7 landed; see decisions log. Kept
for reference alongside [otto.md](otto.md) (superseded by this design).

## Summary

Otto becomes the project-level orchestrator and the **sole writer of goals**.
Workers (build, frontend, git, …) stay completely goal-unaware: they receive a
delegated task, execute it, and return a result. Otto verifies results and
updates the goal ledger itself.

Two clean layers of planning remain:

- **Goals** — strategic, persistent, project-scoped ledger. Owned by otto only.
- **Todos** (`update_todos`) — tactical, per-turn scratchpad. Used by any agent
  while working a single task. Unchanged.

The existing single-session experience (Agents tab) is untouched — goals are
purely additive via the Otto tab.

## Target model

```
project
 └── goal (project-scoped, persistent)
      ├── otto session        ← otto's chat/supervision thread for THIS goal
      ├── tasks[] (ordered)
      │     └── worker session / subagent   ← dispatched execution per task
```

### Orchestration loop (single writer)

```
otto: goal_list → pick task(s) → goal_update(in_progress) → delegate_task(agent, …)
        … worker runs, fully goal-unaware (may use update_todos internally) …
otto: receives delegation result → verifies (message_subagent to interrogate if needed)
        → goal_update(completed) | re-dispatch | note + retry | blocked
```

- Otto may dispatch multiple independent tasks in parallel (delegate_task is
  async). Sequential tasks are expressed by queue order.
- The delegation **result summary is the load-bearing artifact** — subagent
  completion prompts should push structured results (outcome, files touched,
  verification run) so otto can judge without re-reading transcripts.

### What dies

- `done_pending` task status (existed only for worker self-claims).
- `allowComplete` ACL branching in goal tools — tools are built for otto only.
- `goal_start` worker prompt injection in `routes/goals.ts` (workers no longer
  drive goals).
- Goal tools in every non-otto agent's toolset (`NO_GOAL_SESSION_TYPES` logic).
- Otto-as-child-of-work-session (`parentSessionId` binding for otto sessions).

### Task statuses (simplified)

`pending → in_progress → completed | blocked | cancelled`

Only otto (or the user via REST/UI) transitions statuses.

## Phases

### Phase 1 — Schema

`goals` already has `projectPath`. Changes:

- `goals`: add `ottoSessionId` (text, nullable) — the otto thread for this
  goal. Drop reliance on `goals.sessionId` as the binding (keep column during
  migration; backfill `ottoSessionId` where an otto session exists, then
  deprecate).
- `goal_tasks`: add `sessionId` (text, nullable) — worker session/subagent
  executing the task. Add `subagentId` (nullable) if useful for drill-down.
- `goal_tasks.status`: remove `done_pending` from the accepted set (migrate
  existing rows → `in_progress`).

Workflow: edit `packages/database/src/schema/`, `bunx drizzle-kit generate`,
update `migrations-bundled.ts`, test locally.

### Phase 2 — Goal tools & runner wiring

`packages/server/src/tools/goals/index.ts`:

- Remove `allowComplete` + `done_pending`; single tool shape for otto.
- `goal_update` gains: assign task → agent (records dispatch), set
  `blocked`/`cancelled` with note, reorder.
- Goal scope = project (active goals for `projectPath`), not session.

`packages/server/src/runtime/agent/runner-setup.ts`:

- Inject goal tools **only when `agent === 'otto'`**. Delete
  `NO_GOAL_SESSION_TYPES`.
- Delegation tools: unchanged (all driver agents at depth 0; subagents still
  excluded).
- `enqueue_session_message`: retarget from parent session → task's worker
  session (notify workers of queue changes mid-flight).

`packages/server/src/runtime/agent/registry.ts`:

- Remove `goal_list`/`goal_update` from any non-otto defaults. Otto keeps
  read/search tools + goal tools + delegation + enqueue.

### Phase 3 — Otto loop per goal

`packages/server/src/runtime/otto/service.ts`:

- `maybeWakeOtto` keys on **goal** (per-project active goals), not parent
  session. Stall state keyed by goal id.
- Wake condition: active goal with open tasks, or errored last run in the
  goal's otto session.
- Goal auto-complete when all tasks closed (existing behavior, re-keyed).
- One otto session per goal — creating a goal from the otto chat attaches that
  conversation as the goal's thread.

`packages/server/src/routes/goals.ts`:

- CRUD stays Zod-first; goal/task schemas updated (no `done_pending`, new
  `ottoSessionId` / task `sessionId` fields).
- "Start goal" dispatches **otto** on the goal's otto session (creating one if
  missing) instead of injecting `goal_start` into a worker session.
- User edits to goals/tasks via REST are picked up by otto on next
  `goal_list` (already true — tools read DB per call).

### Phase 4 — Subagent result quality

`packages/server/src/runtime/subagents/`:

- Completion prompt: require structured result — outcome, files changed,
  verification performed, open issues.
- `message_subagent` is otto's interrogation path before marking complete.

### Phase 5 — API client

- Regenerate OpenAPI + SDK: `bun run --filter @ottocode/api generate`.

### Phase 6 — UI (web-sdk)

Tabs: **Agents | Otto**.

- **Agents tab** — today's experience, unchanged. Session list, direct chat,
  todos, delegation. No goal surfaces.
- **Otto tab**:
  - Left rail lists otto sessions (one per goal) — same session-list
    primitive as the Agents tab, so switching tabs lands in a familiar place.
  - Overview: goals with status chips, progress (n/m tasks), last activity.
  - Goal view: task queue (status, assigned agent, worker session link) +
    otto chat thread for that goal. Talking to otto here is how goals get
    created/updated in natural language.
  - Task drill-down: opens the worker session/subagent transcript.
- Remove the standalone goals panel; goal state renders inside the Otto tab.
- Otto activity (verified/completed/re-dispatched) surfaces as compact
  activity events (extend `compactActivity.ts`), not regular bubbles.
- Follow frontend performance boundaries (narrow selectors, gate hidden
  panels) per AGENTS.md.

### Phase 7 — Cleanup & tests

- Delete dead code: `done_pending` paths, `allowComplete`, `goal_start`
  injection, per-parent-session stall tracking.
- Tests (`bun:test`, in `tests/`): goal tool single-writer behavior, otto
  wake-per-goal, status transitions, route schemas.
- Docs: update `docs/architecture.md` and goal/otto docs.

## Decisions log

- Goals are project-scoped; otto is their only writer. Workers get zero goal
  tools (not even claim-only) — otto updates the ledger from delegation
  results.
- One otto thread per goal (no interleaved multi-goal context). Cross-goal
  overview is a DB query/UI, not an LLM.
- Otto is a mode (tab), not the universal front door — direct agent sessions
  stay first-class.
- Todos remain per-agent tactical planning; goals never replace them.
- Depth-1 delegation unchanged: subagents cannot re-delegate.

## Open questions

- Task dependency hints (parallel vs sequential) beyond queue order — defer
  until otto demonstrably needs it.
- Cross-goal "meta-otto" chat — additive later; not in scope.
- Whether `goals.sessionId` column is dropped immediately or after a
  deprecation window (TUI/desktop clients may read it).
