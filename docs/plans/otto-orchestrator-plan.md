# Otto Orchestrator Plan

Status: mostly implemented (June 2026), with explicit legacy/compatibility
paths still present. Kept for reference alongside [otto.md](otto.md)
(superseded by this design).

## Summary

Otto is the project-level orchestrator and the **sole AI writer of goals**.
Workers (build, frontend, git, …) stay goal-unaware: they receive a delegated
task, execute it, and return a result. Otto verifies results and updates the
goal ledger itself. Users and REST/UI endpoints can still edit goals directly.

Two clean layers of planning remain:

- **Goals** — strategic, persistent, project-scoped ledger. Owned by otto only.
- **Todos** (`update_todos`) — tactical, per-turn scratchpad. Used by any agent
  while working a single task. Unchanged.

The existing single-session experience (Agents tab) is untouched — goals are
purely additive via the Otto tab.

## Current model

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

### Removed

- `done_pending` task status (existed only for worker self-claims).
- `allowComplete` ACL branching in goal tools — tools are built for otto only.
- Goal tools in every non-otto agent's toolset (`NO_GOAL_SESSION_TYPES` logic).

### Legacy/compatibility paths still present

These are intentionally narrow and should not be treated as the target model:

- `goals.sessionId` remains active for session-scoped compatibility endpoints
  (`/v1/sessions/{sessionId}/goal`) and for older goal rows. New goal-thread
  ownership is `goals.ottoSessionId`, but session-goal POST still writes
  `goals.sessionId` and does not create/set `ottoSessionId` until start/wake.
- `ensureOttoSessionForGoal` adopts a legacy otto session that is a child of
  `goals.sessionId` before creating a new per-goal otto session.
- `findOrCreateLegacyOttoSession` can create a goal-less otto session for an
  errored worker/session run, still bound with `sessions.parentSessionId`.
- `runner-setup.ts` keeps a `currentParentSessionId` fallback for legacy otto
  child sessions so `goal_list`/`goal_update` and `enqueue_session_message`
  operate on the supervised parent session when no per-goal binding exists.
- `AUTOMATED_PREFIXES` still includes `<goal_start` so historical automated
  messages do not reset stall state or appear as manual user input.

### Task statuses (simplified)

`pending → in_progress → completed | blocked | cancelled`

Only otto (or the user via REST/UI) transitions statuses.

## Phases

### Phase 1 — Schema (implemented with compatibility)

`goals` already has `projectPath`. Changes:

- `goals`: `ottoSessionId` (text, nullable) is the otto thread for this goal.
  `goals.sessionId` remains for compatibility and has not been dropped.
- `goal_tasks`: `sessionId` (text, nullable) records the worker/subagent
  session executing the task. There is no `goal_tasks.subagentId` column.
- `goal_tasks.status`: remove `done_pending` from the accepted set (migrate
  existing rows → `in_progress`).

Workflow: edit `packages/database/src/schema/`, `bunx drizzle-kit generate`,
update `migrations-bundled.ts`, test locally.

### Phase 2 — Goal tools & runner wiring (implemented with compatibility)

`packages/server/src/tools/goals/index.ts`:

- Remove `allowComplete` + `done_pending`; single tool shape for otto.
- `goal_update` gains: assign task → agent (records dispatch), set
  `blocked`/`cancelled` with note, reorder.
- Goal tool scope is the current otto/legacy session: `goal_list`/`goal_update`
  load the active goal for `goals.ottoSessionId` or legacy `goals.sessionId`.
  REST `/v1/goals` is the project-wide listing surface.

`packages/server/src/runtime/agent/runner-setup.ts`:

- Inject goal tools **only when `agent === 'otto'`**. Delete
  `NO_GOAL_SESSION_TYPES`.
- Delegation tools: unchanged (all driver agents at depth 0; subagents still
  excluded).
- `enqueue_session_message`: otto must pass the target `sessionId` explicitly
  for normal per-goal orchestration. It only defaults to the supervised parent
  session for legacy child-otto sessions; it does not infer a worker session
  from a task id.

`packages/server/src/runtime/agent/registry.ts`:

- Remove `goal_list`/`goal_update` from any non-otto defaults. Otto keeps
  read/search tools + goal tools + delegation + enqueue.

### Phase 3 — Otto loop per goal (implemented with compatibility)

`packages/server/src/runtime/otto/service.ts`:

- `maybeWakeOtto` runs when a worker/idle session finishes. It resolves the
  goal via `goal_tasks.sessionId`, then legacy `goals.sessionId`. Stall state
  is keyed by goal id, with a session-id fallback for goal-less legacy wakeups.
- Wake condition: resolved active goal with open tasks, or an errored last
  assistant run in the idle worker/session being observed. Otto sessions do
  not self-wake based on their own last run.
- Goal auto-complete when all tasks closed (existing behavior, re-keyed).
- One otto session per goal is the target. Current code creates/binds
  `goals.ottoSessionId` on goal creation from otto tools and on goal start;
  compatibility code may adopt an older child otto session first.

`packages/server/src/routes/goals.ts`:

- CRUD stays Zod-first; goal/task schemas updated (no `done_pending`, new
  `ottoSessionId` / task `sessionId` fields).
- "Start goal" dispatches **otto** on the goal's otto session (creating one if
  missing) instead of injecting `goal_start` into a worker session. The
  historical `<goal_start` prefix remains recognized only as automated-message
  compatibility.
- User edits to goals/tasks via REST are picked up by otto on next
  `goal_list` (already true — tools read DB per call).
- Session-goal REST endpoints remain compatibility endpoints over
  `goals.sessionId`; project-level goal endpoints are the canonical REST
  surface for project-wide goal state.

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

### Phase 7 — Cleanup & tests (partially complete)

- Deleted dead code: `done_pending` paths, `allowComplete`, worker
  `goal_start` injection, and broad non-otto goal tools.
- Still present by design/compatibility: `goals.sessionId`, legacy child-otto
  adoption, goal-less errored legacy wakeups, `currentParentSessionId` fallback,
  and `<goal_start` automated-prefix handling.
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
