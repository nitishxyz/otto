# Otto Web SDK UI Audit Findings

Audit of `packages/web-sdk/src/components/otto/` (read-only review). Covers
`OttoGoalBar.tsx`, `OttoTabBar.tsx`, `OttoSessionRail.tsx`, `OttoWorkspace.tsx`,
`OttoSessionView.tsx`, and `index.ts`, plus referenced modules
(`hooks/useGoals.ts`, `chat/NewSessionLanding.tsx`,
`sessions/SessionListContainer.tsx`, `chat/InputTodosBar.tsx`).

## Summary

The otto components are small and consistent with the Agents-tab primitives,
but several states are missing (loading/error, completed/abandoned goals,
otto-disabled hosts), there are keyboard-accessibility gaps in the goal bar,
and the tab bar uses non-standard tab semantics. No issues were found in
`index.ts` or `OttoSessionView.tsx`.

## Findings

### OttoGoalBar.tsx

1. **No loading/error state for goals query.** `useProjectGoals()` only
   destructures `data`; on fetch error the bar silently collapses with no
   feedback.
2. **`startGoal` mutation has no `onError`.** A failed Start shows nothing —
   inconsistent with add-task and delete-task, which both toast errors.
3. **No completed/abandoned goal state.** The collapsed bar renders finished
   goals identically to active ones ("Goal | <task> — n/n done"), and
   `AddTaskComposer` disappears silently for non-active goals. `pickVisibleTask`
   falls back to `tasks[0]` (a completed task) when everything is done.
4. **Delete button invisible on keyboard focus.** The row delete button uses
   `opacity-0 group-hover:opacity-100` without `focus-visible:opacity-100`, so
   keyboard users can focus an invisible control.
5. **Hidden panels stay focusable.** The `0fr` / `opacity-0` grid-collapse
   trick keeps both the collapsed and expanded header buttons in the DOM and
   tab order; nothing applies `inert`, `aria-hidden`, or `visibility: hidden`
   to the hidden half. The same pattern exists in `InputTodosBar.tsx`.
6. **Bulk-disable on delete.** `deleteDisabled={deleteTask.isPending}` greys
   out every row's delete button with no per-row pending indicator.
7. **Misleading empty copy.** "…or add tasks below" is shown for any goal with
   zero tasks, but the composer only renders for `active` goals — a non-active
   empty goal would show a broken promise.

### OttoTabBar.tsx

8. **Non-standard tab semantics.** Uses `aria-pressed` buttons instead of
   `role="tablist"` / `role="tab"` with `aria-selected`.

### OttoSessionRail.tsx / OttoWorkspace.tsx

9. **No otto-disabled handling.** `useOttoEnabled()` only gates the goals
   query (the bar hides), but the rail, workspace, and tab bar render normally
   when otto is disabled; nothing in this directory checks the flag.
10. **Copy/casing inconsistency.** Rail empty state says "No otto sessions
    yet" (lowercase) while the tab label and JSDoc use "Otto".

### Cross-cutting

11. **Goal resolution assumes 1:1 session↔goal.**
    `data?.goals.find((g) => g.ottoSessionId === sessionId)` shows only the
    first match; multiple goals attached to one otto session would be silently
    hidden.

## Suggested Fixes

| # | Fix |
|---|-----|
| 1 | Surface `isError` from `useProjectGoals()` (subtle inline notice or toast), or document the intentional silent-hide. |
| 2 | Add an `onError` toast to the `startGoal.mutate` call, matching `handleDelete`. |
| 3 | Show a status badge/check icon when `goal.status !== 'active'`, and show `goal.title` instead of `pickVisibleTask` output when all tasks are done. |
| 4 | Add `focus-visible:opacity-100` to the delete button classes. |
| 5 | Toggle `inert` or `visibility: hidden` on the hidden panel after the transition; apply the same fix to `InputTodosBar.tsx`. |
| 6 | Track a per-task pending id and disable only the affected row. |
| 7 | Guard the empty-state copy: only mention "add tasks below" when the goal is `active`. |
| 8 | Adopt `role="tablist"` / `role="tab"` + `aria-selected` (or align with other SDK tab switchers). |
| 9 | Document that the host must gate the Otto tab on `useOttoEnabled()`, or export a guard component/hook from the otto index. |
| 10 | Pick one casing for "Otto" in user-facing copy. |
| 11 | Handle multiplicity explicitly — assert, or show the most recent active goal. |

## Follow-up Priority

- **High:** 1, 2 (silent failures), 9 (feature renders when disabled).
- **Medium:** 3 (missing terminal-state UI), 4, 5 (keyboard accessibility), 11 (data-model assumption).
- **Low:** 6, 7, 8, 10 (polish and semantics).
