# Optional Route and SDK Cleanup Plan

## Purpose

The primary runner/provider/tool-adapter refactor is complete. This follow-up plan captures the remaining optional cleanup targets so the current progress can be committed separately, then future work can continue in smaller, safer batches.

The remaining work is mostly route-module modularization and deeper SDK patch/tool utility cleanup. These are not blockers for the completed runtime refactor.

## Goals

1. Continue reducing oversized files and mixed responsibilities.
2. Keep each follow-up batch small enough to review independently.
3. Preserve public API behavior, OpenAPI schemas, stream contracts, and SDK behavior.
4. Prefer service/spec/helper extraction over behavior rewrites.
5. Keep validation focused per phase, plus server/SDK typechecks.

## Non-Goals

- No database schema changes.
- No OpenAPI behavior/schema changes unless explicitly planned.
- No generated SDK updates unless route schemas intentionally change.
- No patch algorithm semantic changes without tests first.
- No broad formatting-only churn.

---

## Current Remaining Hotspots

## Progress Update

Completed in the current cleanup series:

- Phase B — Sessions route split
  - `sessions.ts` is now registration-only.
  - Endpoint groups live under `packages/server/src/routes/sessions/`.
  - Shared session behavior lives in `sessions/service.ts`.
- Phase C — MCP route split
  - `mcp.ts` is now registration-only.
  - MCP server/config/lifecycle/auth concerns are split under `packages/server/src/routes/mcp/`.
- Phase D — OttoRouter route split
  - `ottorouter.ts` is now registration-only.
  - Wallet, billing, top-up, and shared service logic are split under `packages/server/src/routes/ottorouter/`.
- Phase E — Auth route split
  - `auth.ts` is now registration-only.
  - Status, wallet, provider API key, OAuth, Copilot, onboarding, shared state, and service helpers are split under `packages/server/src/routes/auth/`.
- Phase F — Research, terminals, and tunnel route split
  - `research.ts`, `terminals.ts`, and `tunnel.ts` now delegate runtime behavior to service modules.
  - Added service modules under `packages/server/src/routes/research/`, `packages/server/src/routes/terminals/`, and `packages/server/src/routes/tunnel/`.
- Phase G — SDK patch internals deeper split
  - Patch matching helpers live in `patch/matching.ts`.
  - Patch indentation adjustment helpers live in `patch/indentation.ts`.
  - Hunk application state lives in `patch/apply-hunk.ts`.
  - Replace parser helpers live in `patch/replace-builder.ts`.
  - Unified parser state helpers live in `patch/unified-state.ts`.
- Phase H — SDK bin manager/logger cleanup
  - Binary path/cache/filesystem/vendor helpers live under `tools/bin-manager/`.
  - Logger formatting and file sinks live under `utils/logger/`.

Latest validation run for Phases G/H:

```bash
bun lint
bun test tests/patch-parse.test.ts tests/patch-apply.test.ts tests/builtin-tools.test.ts
bun run --filter @ottocode/sdk typecheck
```

Remaining planned cleanup is limited to optional future route/config/git splits.

### Large route modules

| File                                       | Current concern                                                | Suggested cleanup style              |
| ------------------------------------------ | -------------------------------------------------------------- | ------------------------------------ |
| `packages/server/src/routes/auth.ts`       | Completed: registration-only, split under `routes/auth/`       | No further Phase E work planned      |
| `packages/server/src/routes/sessions.ts`   | Completed: registration-only, split under `routes/sessions/`   | No further Phase B work planned      |
| `packages/server/src/routes/ottorouter.ts` | Completed: registration-only, split under `routes/ottorouter/` | No further Phase D work planned      |
| `packages/server/src/routes/mcp.ts`        | Completed: registration-only, split under `routes/mcp/`        | No further Phase C work planned      |
| `packages/server/src/routes/research.ts`   | Completed: route/spec orchestration with service extraction    | Optional future spec extraction only |
| `packages/server/src/routes/terminals.ts`  | Completed: route/spec orchestration with service extraction    | Optional future spec extraction only |
| `packages/server/src/routes/tunnel.ts`     | Completed: route/spec orchestration with service extraction    | Optional future spec extraction only |

### Medium route/config/git modules to consider later

- `packages/server/src/routes/files.ts` — already improved with `files/service.ts`, still route-spec heavy.
- `packages/server/src/routes/skills.ts` — now clean registration-only file after optional cleanup.
- `packages/server/src/routes/config/models.ts`
- `packages/server/src/routes/config/providers.ts`
- `packages/server/src/routes/git/staging.ts`
- `packages/server/src/routes/git/commit.ts`
- `packages/server/src/routes/git/remote.ts`

### SDK patch/tool utilities

| File                                                               | Current concern                                           | Suggested cleanup style         |
| ------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------- |
| `packages/sdk/src/core/src/tools/builtin/patch/apply.ts`           | Completed: split matching, indentation, hunk application  | No further Phase G work planned |
| `packages/sdk/src/core/src/tools/builtin/patch/parse-enveloped.ts` | Completed: replace-builder extraction                     | No further Phase G work planned |
| `packages/sdk/src/core/src/tools/builtin/patch/parse-unified.ts`   | Completed: unified state extraction                       | No further Phase G work planned |
| `packages/sdk/src/core/src/tools/bin-manager.ts`                   | Completed: path/filesystem/vendor/cache helper extraction | No further Phase H work planned |
| `packages/sdk/src/core/src/utils/logger.ts`                        | Completed: format/sink helper extraction                  | No further Phase H work planned |

---

## Recommended Follow-Up Phases

### Phase A — Commit current completed refactor

Purpose: preserve the completed runtime and optional cleanup work before starting riskier route splits.

Tasks:

1. Review full `git diff`.
2. Decide whether to create one commit or multiple commits by completed phase:
   - plan doc
   - tool adapter split
   - runner split
   - setup/provider/reasoning/registry split
   - route/files + SDK tool cleanup
   - optional skills + patch hunk cleanup
3. Ensure staged/unstaged state is intentional.
4. Run focused validation one last time if needed.

Suggested validation:

```bash
bun lint
bun test tests/oauth-codex-continuation.test.ts tests/oauth-codex-text-guard.test.ts tests/reasoning-config.test.ts tests/custom-providers.test.ts tests/server-standalone.test.ts tests/agents-prompts.test.ts tests/runner-provider-options-merge.test.ts tests/tool-options.test.ts tests/tool-approval-modes.test.ts tests/tools.test.ts tests/builtin-tools.test.ts tests/patch-parse.test.ts tests/patch-apply.test.ts tests/skills.test.ts tests/skills-enhanced.test.ts
bun run --filter @ottocode/sdk typecheck
bun run --filter @ottocode/server typecheck
```

Exit criteria:

- Current work is committed or otherwise safely checkpointed.
- Working tree is clean before next optional phase starts.

### Phase B — Sessions route split — Completed

Risk: medium-high.

Why first:

- `sessions.ts` is one of the largest route modules.
- Session behavior is core, but easier to split by endpoint group than auth flows.

Candidate extraction:

- `packages/server/src/routes/sessions/spec.ts`
  - route specs/schemas
- `packages/server/src/routes/sessions/service.ts`
  - shared session lookup, project/cwd handling, error helpers
- Optional endpoint modules if needed:
  - `sessions/create.ts`
  - `sessions/list.ts`
  - `sessions/messages.ts`
  - `sessions/metadata.ts`

Rules:

- Preserve all route paths and operation IDs.
- Avoid changing response payload shapes.
- Prefer moving handlers verbatim before simplifying.

Suggested validation:

```bash
bun lint
bun test tests/server-standalone.test.ts tests/sessions-agent.test.ts tests/user-context.test.ts tests/context-header.test.ts
bun run --filter @ottocode/server typecheck
```

Exit criteria:

- `sessions.ts` becomes route registration/orchestration only.
- Session tests pass.

Completed outcome:

- `packages/server/src/routes/sessions.ts` is registration-only.
- Route groups were split into `sessions/crud.ts`, `sessions/queue.ts`, `sessions/share.ts`, and `sessions/retry.ts`.
- Shared behavior was extracted to `sessions/service.ts`.

### Phase C — MCP route split — Completed

Risk: medium.

Candidate extraction:

- `packages/server/src/routes/mcp/spec.ts`
- `packages/server/src/routes/mcp/service.ts`
- Optional helpers:
  - `mcp/auth.ts`
  - `mcp/config.ts`
  - `mcp/lifecycle.ts`
  - `mcp/tools.ts`

Rules:

- Preserve MCP auth/token handling exactly.
- Preserve server lifecycle behavior and event payloads.
- Avoid changing config file formats.

Suggested validation:

```bash
bun lint
bun test tests/mcp-copilot-auth.test.ts tests/server-standalone.test.ts
bun run --filter @ottocode/server typecheck
```

Exit criteria:

- MCP route module is split by concerns.
- Existing MCP/auth tests pass.

Completed outcome:

- `packages/server/src/routes/mcp.ts` is registration-only.
- Routes and shared state/service logic were split under `packages/server/src/routes/mcp/`.

### Phase D — OttoRouter route split — Completed

Risk: medium-high.

Candidate extraction:

- `packages/server/src/routes/ottorouter/spec.ts`
- `packages/server/src/routes/ottorouter/catalog.ts`
- `packages/server/src/routes/ottorouter/auth.ts`
- `packages/server/src/routes/ottorouter/billing.ts`
- `packages/server/src/routes/ottorouter/service.ts`

Rules:

- Preserve provider catalog shape and model ownership metadata.
- Preserve auth behavior and env/config precedence.
- Preserve balance/top-up behavior.

Suggested validation:

```bash
bun lint
bun test tests/ottorouter-catalog.test.ts tests/custom-providers.test.ts tests/provider-prompts.test.ts
bun run --filter @ottocode/server typecheck
```

Exit criteria:

- OttoRouter route code is split into catalog/auth/billing concerns.
- Provider catalog tests pass.

Completed outcome:

- `packages/server/src/routes/ottorouter.ts` is registration-only.
- Wallet, billing, top-up, and shared service logic were split under `packages/server/src/routes/ottorouter/`.

### Phase E — Auth route split — Completed

Risk: high.

Why later:

- `auth.ts` is the largest and likely highest-risk route file.
- It probably contains multiple provider-specific OAuth/token flows.

Candidate extraction:

- `packages/server/src/routes/auth/spec.ts`
- `packages/server/src/routes/auth/service.ts`
- Provider-specific modules:
  - `auth/openai.ts`
  - `auth/anthropic.ts`
  - `auth/copilot.ts`
  - `auth/setu.ts`
  - `auth/ottorouter.ts`
- Shared helpers:
  - `auth/callback.ts`
  - `auth/session.ts`
  - `auth/errors.ts`

Rules:

- Move code first, then simplify.
- Preserve token storage format and callback URLs.
- Preserve provider-specific environment variable precedence.
- Be careful with web OAuth callback behavior.

Suggested validation:

```bash
bun lint
bun test tests/auth-web-openai.test.ts tests/openai-oauth-client.test.ts tests/oauth-models.test.ts tests/mcp-copilot-auth.test.ts tests/cli-auth-gate.test.ts tests/cli-startup.test.ts
bun run --filter @ottocode/server typecheck
```

Exit criteria:

- Auth route is split by provider/flow.
- OAuth/auth tests pass.

Completed outcome:

- `packages/server/src/routes/auth.ts` is registration-only.
- Status, wallet, provider API key, OAuth, Copilot, onboarding, shared state, and service helpers were split under `packages/server/src/routes/auth/`.

### Phase F — Research, terminals, and tunnel route split — Completed

Risk: medium.

Candidate extraction:

- `packages/server/src/routes/research/service.ts`
- `packages/server/src/routes/research/spec.ts`
- `packages/server/src/routes/terminals/service.ts`
- `packages/server/src/routes/terminals/spec.ts`
- `packages/server/src/routes/tunnel/service.ts`
- `packages/server/src/routes/tunnel/spec.ts`

Rules:

- Preserve terminal stream/lifecycle behavior.
- Preserve tunnel lifecycle behavior.
- Preserve research API response shapes.

Suggested validation:

```bash
bun lint
bun test tests/server-standalone.test.ts tests/builtin-tools.test.ts
bun run --filter @ottocode/server typecheck
```

Exit criteria:

- Each route file is primarily registration/spec orchestration.
- Existing tests pass.

Completed outcome:

- `packages/server/src/routes/research.ts` delegates DB/session behavior to `research/service.ts`.
- `packages/server/src/routes/terminals.ts` delegates terminal lifecycle, WebSocket, SSE, input, resize, and kill behavior to `terminals/service.ts`.
- `packages/server/src/routes/tunnel.ts` delegates tunnel lifecycle, status, QR, and SSE behavior to `tunnel/service.ts`.

### Phase G — SDK patch internals deeper split — Completed

Risk: medium-high.

Current completed safe extractions:

- `apply-report.ts`
- `hunk-header.ts`
- `matching.ts`
- `indentation.ts`
- `apply-hunk.ts`
- `replace-builder.ts`
- `unified-state.ts`

Completed extraction:

- `patch/matching.ts`
  - `findLineIndex`
  - `findSubsequence`
  - `lineExists`
  - line comparison helpers
- `patch/indentation.ts`
  - replacement/addition indentation adjustment helpers
- `patch/apply-hunk.ts`
  - hunk application state machine
- `patch/replace-builder.ts`
  - Replace-mode builder logic from `parse-enveloped.ts`
- `patch/unified-state.ts`
  - unified parser operation builder helpers

Rules:

- No algorithm behavior change in first pass.
- Extract helpers with tests already green.
- Add tests before changing matching or indentation semantics.

Suggested validation:

```bash
bun lint
bun test tests/patch-parse.test.ts tests/patch-apply.test.ts tests/builtin-tools.test.ts
bun run --filter @ottocode/sdk typecheck
```

Exit criteria:

- Patch modules are smaller and still fully covered by existing patch tests.

### Phase H — SDK bin manager/logger cleanup — Completed

Risk: low-medium.

Completed extraction:

- `bin-manager/cache.ts`
- `bin-manager/filesystem.ts`
- `bin-manager/paths.ts`
- `bin-manager/vendor.ts`
- `logger/format.ts`
- `logger/sinks.ts`

Rules:

- Preserve CLI/runtime logging behavior.
- Preserve binary resolution and install/cache locations.
- Avoid changing environment variable behavior.

Suggested validation:

```bash
bun lint
bun test tests/builtin-tools.test.ts tests/tools.test.ts
bun run --filter @ottocode/sdk typecheck
```

Exit criteria:

- Utility modules are smaller and responsibilities are named.

---

## General Refactor Rules

1. Work one phase at a time.
2. Move code before simplifying it.
3. Keep route paths, operation IDs, and schemas stable unless intentionally changing API behavior.
4. Avoid updating generated API clients unless schemas intentionally change.
5. Preserve existing error response status codes and payload shapes.
6. Run focused tests after every phase.
7. Do not combine high-risk auth/session changes with unrelated SDK cleanup.

## Definition of Done for Follow-Up Cleanup

The optional cleanup work is complete when:

1. Major route modules are split into route registration, specs, and service/helpers.
2. SDK patch parser/apply internals have named helper modules for matching, indentation, reporting, and parser state.
3. Utility modules like bin manager/logger are smaller only if the extraction is clearly helpful.
4. Focused tests and typechecks pass after each phase.
5. Public API, stream, provider, auth, and patch behavior remain unchanged unless explicitly documented.
