# Runner, Provider, and Tool Adapter Refactor Plan

## Problem

The core agent runtime works, but several crucial files have accumulated too many responsibilities, compatibility branches, fallback paths, and duplicated helper logic. This makes behavior hard to reason about and makes future provider/tool changes risky.

The largest hotspots are:

| Area                |                                                                                                File |                Size | Main issue                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------: | ------------------: | -------------------------------------------------------------------------------------------------------------- |
| Agent loop          |                                                       `packages/server/src/runtime/agent/runner.ts` |          ~808 lines | Orchestration, streaming, persistence, event observation, fallback handling all mixed together                 |
| Tool wrapping       |                                                              `packages/server/src/tools/adapter.ts` |          ~811 lines | Tool events, DB persistence, approvals, guards, cwd handling, streaming, and special cases all in one function |
| Runner setup        |                                                 `packages/server/src/runtime/agent/runner-setup.ts` |          ~453 lines | Prompt/model/tool/provider setup phases are inline and hard to test separately                                 |
| Provider resolution | `packages/server/src/runtime/provider/index.ts` + `packages/sdk/src/core/src/providers/resolver.ts` | ~455 lines combined | Similar provider factory logic exists in both server and SDK                                                   |
| Reasoning options   |                                                 `packages/server/src/runtime/provider/reasoning.ts` |          ~362 lines | Large branching provider/model heuristic module                                                                |
| Agent registry      |                                                     `packages/server/src/runtime/agent/registry.ts` |          ~423 lines | Prompt fallback discovery and defaults are manual and repetitive                                               |

There are also very large route modules, but the first cleanup pass should focus on runtime internals before touching API route organization.

## Goals

1. Reduce file size and cognitive load in the core runtime.
2. Keep behavior stable while refactoring.
3. Remove duplicated helper logic and dead/disabled stubs.
4. Make provider/tool behavior easier to test in isolation.
5. Create clearer module boundaries around:
   - runner orchestration
   - stream part handling
   - tool event publishing
   - tool persistence
   - provider factory resolution
   - reasoning provider options
   - agent prompt fallback resolution

## Non-Goals

- No public API behavior changes in the first pass.
- No database schema changes.
- No provider behavior changes unless explicitly identified and tested.
- No broad route-module rewrite until runtime cleanup is complete.
- No formatting-only churn outside touched files.

---

## Current Hotspot Map

### 1. `runner.ts`

Current responsibilities:

- session queue loop
- `runAssistant` orchestration
- MCP prepare-step integration
- continuation/system reminder injection
- turn dump wiring
- tool event subscription and finish detection
- latency logging
- `streamText` invocation
- full stream iteration
- tool-input tracing stubs
- text delta persistence
- reasoning part routing
- finish-step fallback event
- stream finish metadata capture
- context-overflow detection and auto-compaction fallback
- final dump flush

Specific smells:

- `runAssistant` is doing almost everything.
- `DEFAULT_TRACED_TOOL_INPUTS`, `shouldTraceToolInput`, and `summarizeTraceValue` duplicate disabled logic from `tools/adapter.ts`.
- Stream part handling is a long chain of `if (part.type === ...)` blocks.
- Error fallback logic is embedded directly in the main function.
- Tool event subscription mutates several `_`-prefixed state flags from closure scope.

Target shape:

```ts
async function runAssistant(opts: RunOpts) {
  const runtime = await createRunnerRuntime(opts);
  const observer = observeRunnerToolEvents(runtime);

  try {
    await maybePreemptivelyCompact(runtime);
    const result = invokeRunnerStream(runtime);
    await consumeRunnerStream(result, runtime);
    await finalizeRunnerStream(result, runtime);
  } catch (error) {
    await handleRunnerError(error, runtime);
    throw error;
  } finally {
    observer.unsubscribe();
    await flushTurnDump(runtime);
  }
}
```

Suggested extracted modules:

- `runner-runtime.ts`
  - runtime object construction from `setupRunner`
  - shared mutable state type
- `runner-reminders.ts`
  - continuation and existing-session reminder messages
- `runner-tool-observer.ts`
  - subscribe/unsubscribe and finish/tool state tracking
- `runner-stream.ts`
  - `invokeRunnerStream`
  - `consumeRunnerStream`
  - stream part dispatch
- `runner-text.ts`
  - text delta filtering, DB insert/update, event publishing
- `runner-errors.ts`
  - context overflow detection and auto-compaction fallback
- `runner-telemetry.ts`
  - latency helpers and tool/message shape summaries

### 2. `tools/adapter.ts`

Current responsibilities:

- tool registration name mapping
- Anthropic tool cache-control hints
- pending call metadata queue
- tool input events
- tool call DB persistence
- tool result DB persistence
- session tool stats updates
- SSE publishing
- approval requests
- safety guard decisions
- cwd/path remapping
- async iterable tool result streaming
- step failure state
- special handling for `progress_update`
- special handling for `update_todos`
- tool error conversion and persistence

Specific smells:

- One exported `adaptTools` function contains almost all behavior.
- Tool call persistence is duplicated for normal tools and `progress_update`.
- Tool result persistence is duplicated for normal results, progress results, blocked calls, rejected calls, and errors.
- `progress_update` special-casing is spread across call and result paths.
- Event payload objects are reconstructed many times.
- Disabled tracing stubs duplicate `runner.ts`.

Target extracted modules:

- `packages/server/src/tools/adapter/index.ts`
  - thin public `adaptTools` wrapper
- `packages/server/src/tools/adapter/types.ts`
  - adapter-local types: pending metadata, execution context, persistence inputs
- `packages/server/src/tools/adapter/pending.ts`
  - pending queue helpers
- `packages/server/src/tools/adapter/events.ts`
  - `publishToolCall`
  - `publishToolDelta`
  - `publishToolResult`
  - `publishPlanUpdated`
- `packages/server/src/tools/adapter/persistence.ts`
  - `persistToolCall`
  - `persistToolResult`
  - `persistToolErrorResult`
  - `updateToolSessionStats`
- `packages/server/src/tools/adapter/execution.ts`
  - `executeBaseTool`
  - cwd/path remapping
  - async iterable handling
- `packages/server/src/tools/adapter/special-tools.ts`
  - `isProgressUpdateTool`
  - `isTodoUpdateTool`
  - special publish/persist policy

First extraction should preserve the existing import path by keeping `packages/server/src/tools/adapter.ts` as the public module, or by converting it to a folder with an `index.ts` only if all imports are updated in one focused commit.

### 3. `runner-setup.ts`

Current responsibilities:

- config and DB loading
- agent config loading
- history loading
- session loading
- project tool discovery
- research database tool injection
- OAuth detection
- system prompt composition
- OpenAI OAuth/spoof adaptation
- debug prompt file writing
- compact-command prompt injection
- additional prompt message injection
- model-family edit tool policy
- tool gating
- model resolution
- devtools model wrapping
- tool context setup
- tool adaptation
- Copilot provider options
- reasoning provider options
- timings and setup logging

Target extracted modules:

- `runner-inputs.ts`
  - config/db/agent/history/session/tools loading
- `runner-prompt.ts`
  - compose prompt, OAuth prompt adaptation, debug prompt write
- `runner-tool-policy.ts`
  - edit tool policy and gating
- `runner-model.ts`
  - model resolution and devtools wrapping
- `runner-provider-options.ts`
  - provider option merge, Copilot flags, reasoning config

Keep the `setupRunner(opts)` public contract stable while moving internals behind helpers.

### 4. Provider resolution

Duplicated/overlapping files:

- `packages/server/src/runtime/provider/index.ts`
- `packages/sdk/src/core/src/providers/resolver.ts`

Duplicated concepts:

- `needsResponsesApi(model)`
- OpenAI vs OpenAI Responses API routing
- OpenAI-compatible provider creation
- custom provider compatibility handling
- apiKey/baseURL/header patterns

Target direction:

- Create a shared SDK provider factory layer that can be used by both SDK and server.
- Keep server-specific auth/topup/session behavior as thin wrappers.
- Prefer table-driven provider handlers over large `if` chains.

Possible shared SDK modules:

- `packages/sdk/src/providers/src/factory.ts`
  - already exists; inspect before changing
- `packages/sdk/src/providers/src/model-resolution.ts`
  - shared `resolveProviderModel`
- `packages/sdk/src/providers/src/openai-responses.ts`
  - shared `needsResponsesApi` and `resolveOpenAIModel`
- `packages/sdk/src/providers/src/compatible.ts`
  - helper for OpenAI-compatible providers

Server target shape:

```ts
export async function resolveModel(provider, model, cfg, options) {
  if (provider === 'ottorouter') return resolveOttoRouterModel(...);
  if (provider === 'copilot') return resolveCopilotModel(...);
  return resolveConfiguredProviderModel({ provider, model, cfg, options });
}
```

This phase has higher regression risk and should come after runner/tool cleanup.

### 5. Reasoning config

Current file is centralized but branch-heavy.

Target shape:

```ts
const REASONING_BUILDERS = {
  anthropic: buildAnthropicReasoningConfig,
  openai: buildOpenAIReasoningConfig,
  google: buildGoogleReasoningConfig,
  ollama: buildOllamaReasoningConfig,
  openrouter: buildOpenRouterReasoningConfig,
  "openai-compatible": buildOpenAICompatibleReasoningConfig,
} satisfies Record<ReasoningProviderTarget, ReasoningBuilder>;
```

Suggested extracted helpers:

- `reasoning-target.ts`
  - target detection
- `reasoning-levels.ts`
  - level normalization and provider-specific effort conversion
- `reasoning-builders.ts`
  - provider-specific option builders

### 6. Agent registry fallback cleanup

Current issues:

- Manual local/global, dir/flat, md/txt path construction.
- Embedded prompt fallback uses an inline `byName` function.
- `promptSource` is tracked but discarded with `void promptSource`.

Target helpers:

- `getAgentPromptCandidates(projectRoot, name)`
- `readFirstNonEmptyFile(paths)`
- `resolvePromptFromAgentsJson(projectRoot, entry)`
- `getEmbeddedAgentPrompt(name)` via a record map
- optional debug logging for prompt source instead of `void promptSource`

---

## Phased Refactor Plan

### Phase 0 — Safety Baseline

Purpose: make sure refactors have guardrails.

Tasks:

1. Run current checks before editing:
   - `bun lint`
   - `bun test`
2. Identify focused tests to run after each phase:
   - `tests/runner-provider-options-merge.test.ts`
   - `tests/tool-options.test.ts`
   - `tests/tool-approval-modes.test.ts`
   - `tests/tools.test.ts`
   - `tests/builtin-tools.test.ts`
   - `tests/ask-stream-capture.test.ts`
   - `tests/oauth-codex-continuation.test.ts`
   - `tests/reasoning-config.test.ts`
   - provider-specific OAuth tests where relevant
3. Add missing narrow tests only when extraction exposes untested behavior.

Exit criteria:

- Baseline checks are known.
- Any existing failures are documented before refactor work starts.

### Phase 1 — Tiny shared utilities and dead tracing cleanup

Risk: low.

Tasks:

1. Extract or centralize `nowMs()` in server runtime utilities.
2. Decide whether tool input tracing is wanted:
   - If no, remove disabled tracing stubs from `runner.ts` and `tools/adapter.ts`.
   - If yes, implement one shared tracing helper behind a debug flag.
3. Keep all behavior identical for normal runs.

Exit criteria:

- No duplicate disabled tracing blocks.
- `runner.ts` and `adapter.ts` lose dead code without behavior changes.

### Phase 2 — Tool adapter event/persistence extraction

Risk: medium-low.

Tasks:

1. Extract event publishers from `tools/adapter.ts`.
2. Extract DB persistence helpers for tool calls/results/errors.
3. Extract session tool stats update.
4. Keep `progress_update` behavior identical:
   - call event published immediately
   - result event published before async/best-effort persistence
5. Keep `update_todos` plan event behavior identical.

Suggested first PR/commit scope:

- Add helper modules.
- Replace duplicated inline call/result persistence with helpers.
- Do not change execution/approval/guard logic yet.

Exit criteria:

- `adaptTools` is shorter and still the only public behavior entrypoint.
- Tool-related tests pass.
- No event payload shape changes.

### Phase 3 — Tool adapter execution extraction

Risk: medium.

Tasks:

1. Extract cwd/path remapping into `executeBaseTool`.
2. Extract async iterable handling into `consumeToolStream`.
3. Extract approval/guard result construction helpers.
4. Keep pending-call ordering and step failure semantics unchanged.

Exit criteria:

- `execute` callback becomes readable orchestration.
- Streaming terminal/shell behavior is unchanged.
- Approval and guard tests pass.

### Phase 4 — Runner stream extraction

Risk: medium.

Tasks:

1. Extract continuation/existing-session reminder construction.
2. Extract tool event observer into a small state object.
3. Extract text delta handling and persistence.
4. Extract stream part dispatcher.
5. Extract stream completion handling.
6. Keep `runAssistant` as high-level orchestration.

Exit criteria:

- `runner.ts` is significantly smaller.
- Stream tests and continuation tests pass.
- Turn dump output remains equivalent where tested.

### Phase 5 — Runner setup extraction

Risk: medium.

Tasks:

1. Extract setup loading phases.
2. Extract prompt composition/debug write.
3. Extract tool policy/gating.
4. Extract provider options/reasoning merge.
5. Preserve `SetupResult` shape initially.

Exit criteria:

- `setupRunner` remains the public setup API.
- Provider options merge tests pass.
- Prompt/system behavior tests pass.

### Phase 6 — Reasoning config table-driven cleanup

Risk: medium.

Tasks:

1. Extract target detection.
2. Extract provider-specific option builders.
3. Convert final branch chain into target lookup.
4. Preserve all current option object shapes.

Exit criteria:

- `tests/reasoning-config.test.ts` passes.
- Snapshot/object expectations are unchanged.

### Phase 7 — Agent registry prompt fallback cleanup

Risk: low-medium.

Tasks:

1. Extract prompt candidate path generation.
2. Extract file reading fallback helper.
3. Replace embedded prompt `if` chain with a map.
4. Either log `promptSource` or remove it fully.

Exit criteria:

- Agent prompt tests pass.
- Custom agent file/path behavior is unchanged.

### Phase 8 — Provider resolver consolidation

Risk: high.

Tasks:

1. Inventory provider-specific behavior in server and SDK resolvers.
2. Create shared helpers for:
   - OpenAI Responses API detection
   - OpenAI-compatible instance creation
   - configured provider apiKey/baseURL/header resolution
3. Move low-risk providers first:
   - `moonshot`
   - `zai`
   - `zai-coding`
   - `minimax`
4. Then consider custom provider compatibility handling.
5. Keep special server-only providers separate until last:
   - `ottorouter`
   - `copilot`
   - OpenAI OAuth/session-specific behavior

Exit criteria:

- Provider tests pass.
- Manual smoke tests for at least one OpenAI-compatible provider and one OAuth provider.
- No silent change to env var precedence.

### Phase 9 — Large route module cleanup

Risk: medium-high, lower priority.

Candidate files:

- `packages/server/src/routes/auth.ts`
- `packages/server/src/routes/sessions.ts`
- `packages/server/src/routes/ottorouter.ts`
- `packages/server/src/routes/mcp.ts`
- `packages/server/src/routes/files.ts`
- `packages/server/src/routes/skills.ts`

Approach:

- Split by endpoint group, not by arbitrary line count.
- Keep OpenAPI paths and generated SDK behavior unchanged.
- Regenerate API only when route schemas/specs change.

Exit criteria:

- Route files align better with the project’s modularity guideline.
- API tests pass.

### Phase 10 — SDK tool loader and patch internals cleanup

Risk: medium, lower priority.

These files appeared in the broader hotspot scan but are not part of the first runner/provider/tool-adapter cleanup path.

Candidate files:

- `packages/sdk/src/core/src/tools/loader.ts`
- `packages/sdk/src/core/src/tools/builtin/patch/apply.ts`
- `packages/sdk/src/core/src/tools/builtin/patch/parse-enveloped.ts`
- `packages/sdk/src/core/src/tools/builtin/patch/parse-unified.ts`
- `packages/sdk/src/core/src/tools/builtin/websearch.ts`
- `packages/sdk/src/core/src/tools/bin-manager.ts`
- `packages/sdk/src/core/src/utils/logger.ts`

Current issues to map before editing:

- `tools/loader.ts` has fallback project-tool discovery paths and manual directory scanning.
- Patch parsing/apply modules are large and have fallback hunk creation paths that need careful tests before simplification.
- `websearch.ts` contains scraper/parser fallbacks that should be isolated behind named strategies.
- `bin-manager.ts` and `logger.ts` contain repeated defensive `try/catch` filesystem/process handling.
- Some utility logic, like `nowMs()`, overlaps with server runtime helpers.

Approach:

- Treat patch internals as high-safety code: add/keep parser and apply tests before refactoring.
- Prefer small extraction helpers over algorithm rewrites.
- Separate "fallback strategy" code from happy-path code, especially for tool loading and web search.
- Avoid changing patch semantics unless tests explicitly describe the behavior change.

Exit criteria:

- Tool loader fallback paths are named and testable.
- Patch parser/apply behavior remains covered by `tests/patch-parse.test.ts` and `tests/patch-apply.test.ts`.
- Web search fallback parsing is split into isolated helpers.
- Shared utilities are reused where practical without introducing SDK/server dependency cycles.

---

## Testing Strategy

Run after every phase:

```bash
bun lint
bun test
```

For faster focused loops, use:

```bash
bun test tests/runner-provider-options-merge.test.ts
bun test tests/tool-options.test.ts tests/tool-approval-modes.test.ts tests/tools.test.ts
bun test tests/builtin-tools.test.ts
bun test tests/ask-stream-capture.test.ts tests/oauth-codex-continuation.test.ts
bun test tests/reasoning-config.test.ts
```

Provider-focused phases should also run:

```bash
bun test tests/custom-providers.test.ts
bun test tests/provider-prompts.test.ts
bun test tests/oauth-models.test.ts
bun test tests/openai-oauth-client.test.ts
bun test tests/mcp-copilot-auth.test.ts
```

SDK tool/patch phases should also run:

```bash
bun test tests/patch-parse.test.ts tests/patch-apply.test.ts
bun test tests/builtin-tools.test.ts tests/tools.test.ts
```

## Risk Register

| Risk                                      | Where              | Mitigation                                                                      |
| ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------- |
| Tool event payload shape changes          | `tools/adapter.ts` | Extract helpers with exact same payloads; test stream clients                   |
| Tool call/result ordering changes         | `tools/adapter.ts` | Preserve synchronous DB writes where currently synchronous                      |
| `progress_update` loses instant rendering | `tools/adapter.ts` | Keep explicit policy and focused test/manual check                              |
| Approval/guard behavior changes           | `tools/adapter.ts` | Keep approval and guard phases untouched until persistence extraction is stable |
| Stream text persistence regressions       | `runner.ts`        | Extract with focused tests around message parts and SSE deltas                  |
| OAuth Codex text guard regressions        | `runner.ts`        | Run OAuth Codex continuation/text guard tests                                   |
| Provider env var precedence changes       | provider resolver  | Document precedence before moving code; add tests if missing                    |
| Reasoning provider option shape changes   | `reasoning.ts`     | Object-shape tests before/after table-driven refactor                           |
| Agent prompt fallback precedence changes  | `registry.ts`      | Add/verify tests for local/global, md/txt, flat/dir precedence                  |
| Patch parser/apply semantic changes       | SDK patch tools    | Keep parser/apply tests green; extract helpers before changing algorithms       |
| Tool loader discovery regressions         | SDK tool loader    | Add focused tests for project/global/fallback discovery paths                   |

## Definition of Done

The refactor is complete when:

1. `runner.ts` is orchestration-focused and no longer owns detailed stream/persistence/error internals.
2. `tools/adapter.ts` is split into clear event, persistence, execution, and policy helpers.
3. Provider resolution has one shared source for common provider factory behavior.
4. Reasoning config is table-driven or otherwise split by provider target.
5. Agent prompt fallback logic is declarative and tested.
6. `bun lint` and `bun test` pass.
7. No public API or stream event contract changes were introduced unintentionally.

## Recommended First Implementation Step

Start with Phase 2, not the provider resolver.

The best first code change is:

1. Add `packages/server/src/tools/adapter/events.ts`.
2. Add `packages/server/src/tools/adapter/persistence.ts`.
3. Move only duplicated event/persistence code out of `adapter.ts`.
4. Keep execution, approval, guard, and pending queue logic in place.

This gives a large readability win with relatively low behavioral risk.
