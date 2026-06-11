# Otto, Goals, and Async Delegation Plan

> **Superseded (June 2026):** the goal model described here (session-scoped
> goals, worker self-claims via `done_pending`, two-phase completion) has been
> replaced by the single-writer orchestrator design in
> [otto-orchestrator-plan.md](otto-orchestrator-plan.md). Goals are now
> project-scoped, bound to a per-goal otto session (`goals.ottoSessionId`),
> and only otto writes goal state. Task statuses:
> `pending | in_progress | completed | blocked | cancelled`.
> The async-delegation primitive and wake-on-idle mechanism below remain
> accurate.

## Vision

Three pieces that share one primitive:

1. **Async delegation** — any agent can hand a task to another configured agent and keep moving. No blocking, no sync mode.
2. **Goals + task queues** — per-session (or global) goal lists that users and agents maintain together.
3. **Otto** — a lightweight built-in agent that wakes up when a session run ends, checks goals/errors/subagents, and enqueues the next move.

The shared primitive: **the server can enqueue a new run into any session without user input.** Everything below is built on that.

Long-term, otto becomes the global controller of ottocode — handling multi-agent work, scheduling, and anything else that needs a steady hand. MVP keeps it a session-end hook, not a daemon.

## Why async-only

Sync delegation blocks the parent and wastes its model time. The whole point of per-agent provider/model config (Claude for UI, GPT for logic) is parallelism:

```txt
user → build agent (gpt): "build the backend + frontend"
build agent: delegate_task(agent: "frontend", task: "...")  ← returns immediately
build agent: keeps working on the backend
frontend agent (claude): works in its own child session in parallel
frontend session finishes → otto/finish-hook notifies parent
parent wakes up (if idle) or sees result on next turn
```

## Existing infrastructure (verified)

- `sessions.parentSessionId` + `sessions.sessionType` exist (free-text column, no migration needed for `'subagent'`).
- `enqueueAssistantRun` in `packages/server/src/runtime/session/queue.ts` already supports per-session queues, one-shot runs, `userContent`/`userContext`, abort controllers, and front-of-queue insertion.
- `createFinishHandler` in `packages/server/src/runtime/stream/finish-handler.ts` is the natural place for the session-end hook (it already publishes `message.completed` and `session.status`).
- Agent registry + `resolveAgentConfig` handle per-agent provider/model/tool resolution.

## Part 1: Async delegation

### Tool: `delegate_task`

```ts
type DelegateTaskInput = {
	agent: string; // target agent name
	task: string; // what to do
	context?: string; // relevant findings/paths from parent
};

type DelegateTaskOutput = {
	childSessionId: string;
	agent: string;
	status: 'started';
};
```

Fire and forget. No `mode` field — async is the only mode.

Provider/model resolution for the child: target agent config override → config defaults. Never inherit the parent's model.

### Flow

```txt
parent calls delegate_task
→ validate target agent exists + is allowed
→ create child session { parentSessionId, sessionType: 'subagent' }
→ store subagent record (see schema below)
→ enqueueAssistantRun on child session with task as userContent
→ tool returns childSessionId immediately
→ parent continues its turn
```

### Result handling (the wake-up)

When a child session's run finishes (finish-handler hook):

```txt
child run completes
→ look up subagent record by child session id
→ mark subagent completed/failed, store summary (child's final assistant text)
→ if parent session is idle (queue empty, not running):
    enqueue a one-shot run on the parent with userContext:
    "Delegated task <id> (<agent>) finished: <summary>"
→ if parent is busy:
    leave the record as 'completed-unreported';
    parent's next run gets pending results injected as context,
    or parent can poll with list_subagents
```

### Companion tool: `list_subagents`

The parent never has to remember what it spawned — the `subagents` table is the
source of truth, and each sub-agent is also a real session row
(`parentSessionId` + `sessionType: 'subagent'`), so the UI can later open any
child as a normal session to peek at its full transcript live.

```ts
type ListSubagentsOutput = {
	subagents: Array<{
		id: string; // subagent record id
		agent: string;
		task: string;
		status: 'running' | 'completed' | 'failed' | 'cancelled';
		summary?: string;
		childSessionId: string;
	}>;
};
```

`list_subagents` also lets the parent poll mid-run (optionally filtered by
status) before deciding whether to finish its turn or wait.

### Guardrails

```txt
maxDepth: 1 (children cannot delegate; otto excepted later)
maxConcurrentPerParent: 3
timeout: 10 minutes per child run, then abort + mark failed
parent abort → abort all running children
child sessions hidden from main session list by default
```

## Part 2: Goals and task queues

### Concepts

- **Goal**: a user-visible objective with an ordered task list. Attached to a session or global to the project.
- **Task**: one item in a goal. Status: `pending | in_progress | done_pending | completed | blocked | cancelled`.
- Users create/edit goals via API/UI; agents create/update via tools.
- This is distinct from the ephemeral `update_todos` tool — goals persist in the database and survive across sessions.
- Completion is **two-phase**: the main agent claims (`done_pending`); otto verifies and finalizes (`completed`). Only otto (or the user) writes `completed`.

### Schema (new tables)

`packages/database/src/schema/goals.ts`:

```ts
goals: {
	id: text (pk)
	projectPath: text
	sessionId: text | null  // null = global goal
	title: text
	status: text  // 'active' | 'completed' | 'abandoned'
	createdAt / updatedAt
}
```

`packages/database/src/schema/goal-tasks.ts`:

```ts
goalTasks: {
	id: text (pk)
	goalId: text (fk)
	position: integer
	content: text
	status: text  // 'pending' | 'in_progress' | 'done_pending' | 'completed' | 'blocked' | 'cancelled'
	note: text | null  // why blocked, verification result, etc.
	createdAt / updatedAt
}
```

`packages/database/src/schema/subagents.ts` (Part 1 needs it too):

```ts
subagents: {
	id: text (pk)
	parentSessionId: text
	childSessionId: text
	agent: text
	task: text
	status: text  // 'running' | 'completed' | 'failed' | 'cancelled'
	summary: text | null
	reported: integer (boolean)  // has the parent been told
	createdAt / updatedAt
}
```

Generate via `bunx drizzle-kit generate`, bundle in `migrations-bundled.ts`.

### Agent tools

```txt
goal_list      — list goals + tasks for session/project
goal_update    — create/update tasks, mark statuses, add notes
```

Keep the surface small. Two tools, not six.

### API routes

Zod-first routes under `packages/server/src/routes/`:

```txt
GET    /v1/projects/:projectId/goals
POST   /v1/projects/:projectId/goals
PATCH  /v1/goals/:goalId
POST   /v1/goals/:goalId/tasks
PATCH  /v1/goals/:goalId/tasks/:taskId
```

Regenerate the API client after adding routes.

## Part 3: Otto

### MVP shape

Otto is **not** a background daemon. It is a built-in agent triggered by the session-end hook:

```txt
main session run completes AND session queue is empty
→ should otto run?
   - session has an active goal with open tasks, OR
   - run finished with finishReason 'error', OR
   - there are unreported completed subagents
→ if yes: enqueue a one-shot otto run in a child session
   { parentSessionId: sessionId, sessionType: 'otto' }
```

Otto's run gets:

- The goal + task list (statuses, notes)
- The tail of the main session transcript (last assistant message, finish reason)
- Unreported delegation results

Otto's tools (read-only + control, no editing):

```txt
read, ls, tree, search, glob   — verify claims against the repo
goal_update                    — mark tasks done/blocked with notes
enqueue_session_message        — inject a continuation into the main session
finish
```

### Otto's decision per run

```txt
1. Everything done + goal complete → mark goal completed, do nothing else.
2. Tasks remain and last run succeeded → enqueue continuation into main session:
   "Tasks remaining: <list>. Continue with the next task."
3. Last run errored → enqueue continuation describing the error + suggested retry.
4. Unreported delegation results → fold them into the continuation message.
5. Anything ambiguous → mark task 'blocked' with a note and stop. Do not loop on uncertainty.
```

### Who judges "goal achieved"

Two-phase completion — the main agent claims, otto confirms:

- The **main agent claims**: via `goal_update` it marks tasks `done_pending`
  as it works — it has the full context and the capable model, but its claim
  is not final.
- **Otto verifies and finalizes**: on wakeup it runs cheap mechanical checks
  against each claim (task says "create X" → does file X exist; did the run
  error; does the transcript actually mention the work). It never deeply
  evaluates correctness.
  - Check passes → otto flips `done_pending` → `completed`.
  - Dubious → otto enqueues a question into the main session ("confirm task 3
    is actually done or finish it") and leaves the claim pending. The main
    agent re-claims with evidence next turn.
  - Clearly false (artifact missing) → otto resets to `in_progress` with a
    note explaining why.
- Only otto (or the user via UI/API) writes `completed`, so a sloppy main
  agent cannot silently skip work.
- **No fallback path.** Goals and otto are one feature: disabling otto
  disables goals too. There is exactly one completion flow
  (claim → verify → complete), so nothing can silently mis-promote.
- **Goal completion** = all tasks `completed`. Otto flips the goal to
  `completed` and stops waking up.

### Loop safety

The loop is: main run ends → otto wakes → otto enqueues continuation → main
runs → ends → otto wakes again. The cap exists to stop a confused agent and
otto from ping-ponging forever. It must be a **stall** cap, not a total cap,
so long goal lists still work:

```txt
maxStalledWakeups per session: 3
  a wakeup is "stalled" when no task changed status since the previous wakeup
  counter resets on any task progress or any user message
  a 40-task goal can run 40+ wakeup cycles as long as tasks keep completing
otto never triggers itself (sessionType 'otto' is excluded from the hook)
otto uses a cheap/fast model by default (configurable like any agent)
toggle disables otto AND goals together (per session or global); no degraded goals-only mode
```

### Why this shape

- One hook, one primitive (enqueue), no scheduler, no polling loops.
- Otto's verification is real (it can read the repo), not just transcript trust.
- Expanding later is additive: give otto `delegate_task` and it fans work out to specialist agents against a goal list — same hook, bigger toolset. From there it grows into the global controller of ottocode.

## Implementation order

### Phase 1: enqueue primitive + subagents

- [ ] `subagents` table + migration.
- [ ] `delegate_task` tool (server runtime tool, registered like existing built-ins).
- [ ] Child session creation (`sessionType: 'subagent'`, hidden from default session list).
- [ ] Finish-handler hook: on child completion, record summary, wake idle parent via `enqueueAssistantRun`.
- [ ] `list_subagents` tool.
- [ ] Parent abort cascades to children; child timeout.

### Phase 2: goals

- [ ] `goals` + `goal_tasks` tables + migration.
- [ ] `goal_list` / `goal_update` tools.
- [ ] Zod-first API routes + regenerate `@ottocode/api`.

### Phase 3: otto MVP

- [ ] Built-in `otto` agent definition (prompt + read-only/control toolset).
- [ ] `enqueue_session_message` tool (otto-only).
- [ ] Session-end hook in finish-handler with trigger conditions + stall cap.
- [ ] Config: single toggle disabling otto + goals together, model override, stall limit (goal tools/routes are gated by the same toggle).

### Phase 4: UI

- [ ] Goals panel (list, statuses, add/edit tasks).
- [ ] Delegation visibility: child session nested under parent tool call.
- [ ] Otto activity surfaced subtly (e.g. "otto checked in: 2 tasks remaining").

## Open questions

- Should otto wake up after *every* main-session completion when a goal exists, or only when the assistant didn't call a goal tool itself that turn? (Lean: only when statuses look stale or finishReason is error.)
- Should delegation results auto-inject into the parent's next prompt even without otto? (Lean: yes — context injection is cheap and otto stays optional.)
- Global goals spanning multiple sessions: which session does otto continue? (MVP: session-scoped goals only; global goals are display-only.)
