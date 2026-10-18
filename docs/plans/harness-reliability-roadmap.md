# Harness Reliability Roadmap

Status: the four residual goals below are implemented and independently reviewed (2026-10-12), subject to the explicit platform and recovery limits below. October 13 acceptance completed green bounded default shared-process and independent split runs of 414 files after fixing cross-file pollution and baseline fixtures. **External desktop acceptance and the unavailable original numbered P0 audit still prevent an unconditional completion claim.**

## Scope and status vocabulary

The October audit identified overlapping ownership of terminal outcomes, tool calls, persistence, project state, retries, and subagent delivery. The current implementation addresses many concrete defects and adds regression coverage. This document records what exists now, rather than treating the original implementation checklist as a completion claim.

- **Implemented**: the named behavior exists in current code and has identified regression coverage. This is not a guarantee across every platform, provider, or failure mode.
- **Partial**: concrete hardening exists, but the structural goal or operational verification remains unfinished.
- **Deferred**: future design work, not part of this hardening pass.
- **Blocked**: an unresolved defect or acceptance check prevents closure.

Task boards, unified subagent management, Docker/remote-machine/VM execution, and restart-surviving queued execution are explicitly **future work**. The present attempt identity, project scope, and delivery seams do not implement those products.

## October 13 acceptance reconciliation

The existing implementation was retained, including the uncommitted desktop notification fixes. The continuation is acceptance work, not the proposed Rust/GPUI rewrite. The structural replacement of the process-singleton `createApp()` is explicitly deferred in Phase 4 below; none of the current extraction exit criteria requires changing its public lifetime contract.

- The Kimi reasoning failure used retired `kimi-k2.5`, absent from the current Kimi catalog. The fixture now uses catalog-supported `kimi-k2.6`, retaining the same option-shape assertions. The generated catalog and production reasoning policy were not changed.
- The agents credential fixture and the judge no-credentials fixture now isolate the secure auth home/state locations and restore environment values in `finally`. Setting only `XDG_CONFIG_HOME` does not isolate secure credentials on macOS. Production credential precedence was not weakened.
- Additional stale acceptance fixtures were reconciled: MCP command metadata includes `memory`; TUI modal renders mount the dimensions provider; the resize import guard matches the actual imported symbol rather than unrelated same-file references; SSE transport/replay fixtures use canonical session event bytes instead of an unsupported `ready` event or a session event without session identity.
- CLI checks on a fresh checkout require generated web assets: `bun run scripts/build-web.ts --verbose` succeeded. Missing `apps/cli/src/web-assets.ts` explained eight initial file-load failures, including `daemon-service` and the external memory MCP client. Generated assets remain ignored build outputs.
- Final default `bun run test` completed **388 repository files: 2,691 pass, 0 fail, 3 skip** (46.29 seconds) and **26 desktop files: 138 pass, 0 fail** (0.135 seconds). Each group runs in one shared process. `scripts/test.ts` supplies explicit `./` file paths and the correct desktop cwd, with a 180-second deadline per group; bare Bun arguments were filters, not directory scoping. Total: **414 files, 2,829 pass, 0 fail, 3 skip**.
- The independent `bun run scripts/check-test-suite.ts` rerun completed **414 isolated files: 2,829 pass, 0 fail, 3 skip**. Each file has a 60-second process deadline, two workers, individual temporary logs, exit status and a JSON result manifest. No file hit the deadline. This corroborates rather than substitutes for the default shared run.
- `bun lint` and `bun typecheck` passed after asset generation; the landing workspace retains one existing Astro hint. API regeneration passed without tracked artifact changes.
- The earlier 300-second timeout (1,567 observed passes, 7 failures, 2 skips) was minimized and fixed. Concurrent prompt-audit snapshots restored global `Date` out of order, leaving time frozen and preventing registry deadlines; audit clock ownership is now serialized and tested. OpenTUI rendering left an incomplete global window, poisoning later web config imports; renderer tests now restore the window descriptor. Web fixtures have failure-safe stream/context cleanup, sidebar storage is injected instead of globally shimmed, and new-session agent coverage supplies/restores its fake credential rather than relying on ambient auth. The seven-file combined reproducer now passes **16 tests**, and the default full shared run is green.
- Native `cargo test` passed 42 tests and `bun run tauri build --no-bundle` produced the arm64 release binary with patched Homebrew Zig 0.15 and Command Line Tools. Bundle/sign/notarization, app launch and multiwindow GUI acceptance remain external. Focused fixture/daemon combined recheck passed 67 tests; desktop combined recheck passed 138. No live daemon restart was performed.

### Traceability of the recorded critical findings

The original numbered P0 audit is not available in the checked-in plans inspected here (the roadmap was introduced in `cba9e8e5`). The matrix below maps the critical defect categories recorded in this roadmap and the cross-layer audit. It cannot establish one-to-one closure of an unavailable external audit; that provenance gap remains explicit rather than inventing P0 IDs.

| Recorded defect / exit criterion | Current owner | Named regression evidence |
|---|---|---|
| Duplicate/late terminal completion; cancellation and continuation races | `runtime/agent/turn/{terminal,finalize,continuation}.ts` | `harness-loop-terminal`, `harness-loop-continuation-attempt`, `harness-loop-execute` |
| Queue ownership, idle-boundary delivery, cross-project event/approval leakage | `runtime/session/queue/`, scoped event bus and approvals | `harness-loop-queue`, `harness-loop-observer`, `harness-loop-project-scope`, `harness-acp-events`, `harness-acp-connection` |
| Stored/request credential identity and concurrent OAuth rotation | SDK auth refresh coordinator and provider adapters | `harness-loop-ask-credentials`, `harness-persist-title-credentials`, `harness-anthropic-auth-refresh`, `kimi-oauth-coordination`, `ottorouter-refresh-coordination` |
| Paths/guards bypass, secret-bearing event persistence, unsafe Forge/plugin execution | `runtime/tools/`, `tools/adapter/`, SDK patch mutation plans | `harness-tools-policy`, `harness-tools-adapter`, `harness-tools-loader-policy`, `harness-patch-path-policy`, `harness-patch-safety`, `harness-orch-forge`, `harness-orch-plugins` |
| Unacknowledged writer flush, nontransactional message/checkpoint ordering | `runtime/persistence/` and message repository | `harness-persist-writer`, `harness-persist-migration`, `harness-persist-checkpoint`, `harness-compaction-dispatch-boundary` |
| Invalid compaction/handoff summaries and config/debug round-trip drift | Shared compaction validation, handoff persistence and config schemas | `harness-loop-compaction`, `harness-ctx-reliability`, `handoff`, `config` |
| Duplicate tool execution/finalization; crash outcome ambiguity | Adapter call identity and file-backed finalization journal/recovery | `harness-tools-adapter`, `harness-tool-finalization-durability` |
| Subagent stop/follow-up overwrite and lost/repeated parent delivery | `runtime/subagents/transitions.ts`, versioned outbox | `harness-orch-subagents`, `harness-persist-subagent-outbox`, `harness-loop-delivery` |
| Project initialization races and registry lock replacement | `runtime/projects/{manager,registry-lock}.ts` | `harness-projects-lifecycle`, `harness-projects-registry-lock`, `harness-orch-subagent-project-scope` |
| Terminal signal success fabrication and native PTY hang | SDK shell engine and macOS isolated PTY helper | `harness-shell-engine`, `harness-shell-lifecycle`, `harness-terminal-helper`, `harness-terminal-cleanup`; upstream Bun remains external |
| Server/API event mismatch, transport truncation, image corruption | SDK event schemas, API decoder, stream cache/refetch | `harness-events-wire`, `harness-image-streaming-regression`, `shared-protocols`, `sse-client-replay` |
| Remote web local-daemon side effects and wrong CLI project headers | CLI connection/runtime policy | `cli-web-command`, `cli-project-context`, `otto-server-url-compat` |
| Daemon restart port race and live version-stale token rotation | CLI daemon process/identity helpers | `daemon-service` (28 tests), `daemon-process`, `daemon-version-mismatch` |
| Lazy command metadata/validation drift and incompatible API errors/reparsed values | CLI command definitions and Zod-first route/error owners | `cli-command-contract`, `api-errors-validation`, `server-zod-valid-routes` |
| Invalid public exports, duplicated provider construction, inverted database dependency | SDK public exports/provider factory and injected DB resolver | `sdk-export-contract`, `provider-dispatch`, `provider-baseurl-precedence`, `harness-database-boundary`, `harness-boundary-imports` |

Test names in this matrix refer to `tests/<name>.test.ts`; server owner paths are under `packages/server/src/`. All matrix test files were included in the completed split run. These are named behavioral regressions, not exhaustive crash/platform proofs. Operational recovery limits below remain unchanged.

## Verification snapshots

The following results were supplied by the coordinating build session on 2026-10-12; this documentation reconciliation did not rerun them.

| Check | Observed result | Interpretation |
|---|---|---|
| Full typecheck | PASS | Typecheck passed at the recorded snapshot. |
| All 49 harness test files | 288 pass, 0 fail | Completed harness run; not proof of every original P0 or native terminal behavior. |
| Focused 8 legacy OAuth/plugin/export/migration files | 44 pass, 0 fail | Completed focused compatibility run. |
| Broad run: 368 files, excluding `daemon-service` | Timed out after 180 seconds; 967 observed pass, 3 fail, 1 skip | **NOT complete.** These are observed counts, not a full-suite result. |
| Earlier acceptance `bun lint` rerun | PASS, exit 0; 2,229 files | Formatting blocker resolved at that snapshot; one informational `useTemplate` diagnostic only. |
| Scope/system-prompt/agents-prompts acceptance tests | All 13 tests pass after test-only cleanup | One-shot assertion blocker resolved in the focused rerun; this was not a broad-suite rerun. |
| Earlier native macOS terminal, Bun 1.4 | Direct spawn hangs in `__wait4` | Historical blocker; production now uses an isolated PTY helper on macOS. The native Bun issue itself is not repaired. |
| Earlier independent continuation review | Lint/typecheck passed; 332 focused tests passed | Historical snapshot before the combined post-fix review below. |
| Independent combined post-fix review | Lint exit 0, 2,250 files; full workspace typecheck exit 0; 401/401 focused tests, 1,399 assertions, 58 files | Passed before the final lease-registration fix; not a full repository-suite result. |
| Broad 100-file subset | 813 pass, 2 fail, 3,029 assertions | Both failures (agents credentials and Kimi reasoning) confirmed against archived HEAD baseline; not a full repository-suite run. |
| Compiled ad-hoc-signed PTY smoke and stress | Smoke exit 0; exact 8/16 MiB output stress; early input passed | Production-helper evidence within the documented macOS/process-group limits. |
| Final narrow independent recheck after lease-registration fix | 24/24 tests, 173 assertions (20 durability + 4 lifecycle); server typecheck passed | Scoped last-fix verification, **not another full combined rerun**. |
| Non-root EACCES lease regression | Four failed opens with mode `0500`, no runtime allocated; restoring `0700` allowed four shared opens with one lease; second-process recovery preserved live pending work | Fail-closed registration and retry/live-owner protection exercised without root permission bypass. |
| Actual in-process plugin-command route with a real terminal | PASS reported by coordinator | Production mitigation evidence, not a native Bun fix or full-suite result; fixture: `tests/harness-terminal-plugin-route.ts`. |
| Legacy agents credentials / Kimi reasoning failures | Both confirmed on archived HEAD by independent review | Existing baseline failures, not evidence of new continuation regressions; no repository-wide final-green claim. |

The earlier acceptance cleanup was test-only. The legacy workspace-writing fixture now uses a temporary project with `finally` cleanup; the existing `.otto/agents/testagent/agent.md` exact old fixture was left untouched. These historical broad timeouts and baseline failures are superseded only by the explicitly recorded October 13 split-suite evidence above, not by earlier focused results.

No old daemon restart was performed for the project-registry lock upgrade. Earlier counts remain historical snapshots. The combined review's last finding was swallowed lease-registration failure; project opening now fails closed before runtime allocation. The final narrow recheck above covers that fix, but the full combined run was not repeated afterward. No remaining review blockers were identified for the four requested goals. Restart recovery has a separate file-journal contract below; it is not inferred from in-process retries.

## Implementation status by workstream

Paths below are project-relative. Test references name coverage to inspect; they are not additional test runs by the documentation author.

### Phase 0: isolated defects - implemented, acceptance still partial

- Queue ownership and idle-boundary handling are in `packages/server/src/runtime/session/queue/` and the runner. Coverage: `tests/harness-loop-queue.test.ts`, `tests/harness-loop-execute.test.ts`.
- Runner/ACP subscriptions and approvals carry project scope; ACP rejects unsupported remote execution rather than mixing remote CRUD with local execution. Coverage: `tests/harness-loop-observer.test.ts`, `tests/harness-acp-events.test.ts`, `tests/harness-acp-connection.test.ts`.
- Anthropic stored API-key forwarding and SDK model construction are corrected. Managed OAuth refresh and explicit-token isolation are described below. Coverage: `tests/harness-loop-providers.test.ts`, `tests/harness-loop-anthropic-oauth.test.ts`.
- Forge dry runs and disabled-plugin execution checks, plugin/skill name validation, and destructive-path checks are hardened. Coverage: `tests/harness-orch-forge.test.ts`, `tests/harness-orch-plugins.test.ts`.
- Summary validation is shared by automatic/manual compaction and handoff. Config/debug round trips and package-export contracts have coverage. See `tests/harness-loop-compaction.test.ts`, `tests/harness-ctx-reliability.test.ts`, and the focused legacy export tests.
- Signal exits are not synthesized as exit code 0. This does **not** close the native terminal hang.

### Phase 1: security and request scope - implemented hardening

- Canonical path resolution precedes guards/approvals and is reused for execution, including symlink-aware workspace/reference confinement. Terminal guards inspect assembled commands and executable writes. Sources: `packages/server/src/runtime/tools/definitions.ts`, `packages/server/src/tools/adapter/input.ts`, `packages/server/src/runtime/tools/guards.ts`. Coverage: `tests/harness-tools-policy.test.ts`, `tests/harness-tools-loader-policy.test.ts`, `tests/harness-patch-path-policy.test.ts`.
- Sensitive tool metadata drives input redaction, input-delta suppression, and known-secret echo scrubbing in output/errors. Forge declares secret-bearing fields and uses secure input. Sources: `packages/server/src/tools/adapter/sensitive.ts`, `packages/server/src/runtime/forge/`. This is declared-field/known-value protection, not a universal secret detector.
- Ask credentials stay request-scoped rather than mutating `process.env`; title/provider paths have scoped credential coverage. Sources: `packages/server/src/runtime/ask/service.ts`, `packages/server/src/runtime/message/title-generation.ts`. Coverage: `tests/harness-loop-ask-credentials.test.ts`, `tests/harness-persist-title-credentials.test.ts`.
- Error/debug payloads are bounded and redacted; approvals run after blocking policy and support cancellation/cleanup. File mentions and skill supporting files use confinement. Coverage: `tests/harness-tools-adapter.test.ts`, `tests/harness-persist-mentions.test.ts`, `tests/harness-ctx-reliability.test.ts`.

### Phase 2: lifecycle and durable state - implemented with recovery limits

| Area | Current behavior and source | Coverage / remaining limit |
|---|---|---|
| Turn ownership | `packages/server/src/runtime/agent/turn/` owns guarded terminal transitions and cancellation-aware continuation claims; runner cleanup is explicit. | `harness-loop-terminal`, `harness-loop-continuation-attempt`, `harness-loop-execute`; restart-surviving queued runs are deferred. |
| Content writer | `packages/server/src/runtime/persistence/part-content-writer.ts` tracks unacknowledged sequences, replays worker failures in-process, and rejects failed durability barriers. Flush is not success without committed writes. | `tests/harness-persist-writer.test.ts`; in-memory unacknowledged state does not survive process death. |
| Turn acceptance and ordering | Acceptance uses transactional repository operations; session message sequence and unique part indices replace timestamp-only ordering. | `tests/harness-persist-migration.test.ts`, `tests/harness-persist-queue-scope.test.ts`; retain migration/legacy compatibility checks. |
| Compaction, branch, handoff | Checkpoint summary identity and summarized-through boundary are separate; checkpoint content/pruning markers commit together; branch/handoff copy state transactionally. | `tests/harness-persist-checkpoint.test.ts`, `tests/harness-compaction-dispatch-boundary.test.ts`; see [Compaction continuity](../compaction-continuity.md). |
| Tool identity and finalization | Adapter execution is keyed by call ID; execution outcome is distinct from idempotent result persistence/finalization. File journals persist intent before execution and outcome before DB finalization; dead-owner recovery never reexecutes tools. | `tests/harness-tools-adapter.test.ts`, `tests/harness-tool-finalization-durability.test.ts`; crash-window unknown outcomes and single-host ownership limits are documented below. No durable execution queue. |
| Subagent attempts and outbox | `packages/server/src/runtime/subagents/transitions.ts` compare-and-sets attempt/status, reserves capacity transactionally, and prevents concurrent stop/finalize/follow-up overwrite. Versioned result delivery claims commit with persisted continuation/result pairs. | `tests/harness-orch-subagents.test.ts`, `tests/harness-persist-subagent-outbox.test.ts`, `tests/harness-loop-delivery.test.ts`; durable result records do not imply durable execution queues. |
| Project resources | Runtime initialization is deduplicated; queues/skills/subagent operations are project-scoped. Registry mutations serialize and use atomic file replacement under SQLite ownership locking. | `tests/harness-projects-lifecycle.test.ts`, `tests/harness-projects-registry-lock.test.ts`, `tests/harness-orch-subagent-project-scope.test.ts`; old daemon restart required, **not performed**. |
| Plugin/MCP lifecycle | Disable/remove reconciles live tools/managers; installation and skill ownership are hardened; lazy refresh handles removals. | `tests/harness-orch-plugins.test.ts`, `tests/harness-orch-mcp.test.ts`; not a unified capability index. |

### Phase 3: consolidation - partial

- **Implemented:** typed tool outcomes and terminal stream requirements, call-ID-aware lazy registration, collision-safe naming, retained result-pair/prepare-step handling, reasoning finalization, truthful pruned history, strict patch matching and validated mutation plans with partial-mutation reporting. Coverage includes `harness-tools-adapter`, `harness-loop-registration`, `harness-loop-reasoning`, `harness-patch-safety`, and `harness-loop-units`.
- **Implemented:** canonical event schemas and route-byte/API decoding with web/TUI adoption and dictation types shared through API. Coverage: `tests/harness-events-wire.test.ts`.
- **Implemented:** memory recall resolves current heads before exclusions; automatic embedding backfill is scoped to authorized candidates and excludes superseded/already-loaded records. Explicit administrative reindex remains a separate operation. See [Shared memory](../shared-memory.md).
- **Implemented shell lifecycle consolidation, independently reviewed:** `ShellExecution` owns pipe/secure-PTY execution lifetime, bounded output, completion, timeout, cancellation and escalation. Transport and host-specific formatting/persistence remain separate. Sources: `packages/sdk/src/core/src/tools/shell/engine.ts`, `packages/server/src/tools/adapter/secure-shell.ts`. Coverage: `tests/harness-shell-engine.test.ts`, `tests/harness-shell-lifecycle.test.ts`, `tests/harness-shell-extension-cancel.test.ts`. Persistent terminals retain their own session manager; this is not a universal remote execution driver.
- **Implemented provider construction consolidation, independently reviewed:** canonical construction dispatch lives in `@ottocode/sdk/providers` (`createProviderModel`); server adapters retain auth selection, discovery and payment policy, not a second construction owner. Sources: `packages/server/src/runtime/provider/index.ts`, `packages/sdk/src/providers/src/`; coverage: `tests/provider-dispatch.test.ts`, `tests/provider-baseurl-precedence.test.ts`, `tests/harness-loop-providers.test.ts`.
- **Partial metadata/cleanup:** shared tool definitions reduce duplicated facts, but do not claim every registry or legacy module has been consolidated or removed.

### Phase 4: package boundaries - partial

- Import-direction/public-entrypoint and browser-safety checks exist in `tests/harness-boundary-imports.test.ts`; SDK domain entrypoints are available.
- The intended direction is `database/install -> sdk -> api -> server -> web-sdk -> apps`. **Database -> SDK exemption removed, independently reviewed:** the database core accepts paths/config shapes and an injected resolver instead of importing SDK config/logger. The cache-usage normalization marker is canonical in `@ottocode/database/markers`, with its value and SDK re-export preserved. Coverage: `tests/harness-database-boundary.test.ts`, `tests/harness-boundary-imports.test.ts`, `tests/provider-baseurl-precedence.test.ts`.
- The private Astro preview also has a narrow source-import exemption. Avoid describing the graph test as an unconditional ban without exemptions.
- Public `getDb(projectRoot?)` remains available through host initialization: importing `@ottocode/sdk/config` (or the SDK root) registers the SDK resolver. Database-only users must register `setDatabasePathResolver` themselves or use `getDbByPath`/`getDbForConfig`; uninitialized `getDb` rejects rather than choosing cwd storage. See [Database configuration boundary](../database-boundary.md). Replacement of the `createApp()` singleton by an instance-owned runtime remains a separate structural follow-up.

## Residual-goal operational contracts

The four continuation goals are database dependency inversion, canonical provider construction, shared shell lifecycle/production PTY mitigation, and restart-durable tool finalization. They are implemented and independently reviewed, with no remaining identified review blockers for this scope, subject to the limits below and the scoped last-fix verification noted above.

### macOS PTY production mitigation

`packages/sdk/src/core/src/terminals/bun-pty.ts` selects `isolated-pty.ts` on macOS. A clean Bun helper runs the real PTY outside the multithreaded server; this avoids the observed direct native `forkpty`/`__wait4` hang on the tested production route. It does **not** repair the upstream Bun 1.4 issue. The in-process route fixture exercises the plugin-command route and real terminal, rather than proving only that a test subprocess can spawn.

Startup is asynchronous: the initial terminal PID is the helper PID (or 0 before available), then the getter reports the PTY child PID after `ready`. A start response is not a readiness/command-success guarantee; startup has a 5-second deadline. Controls are acknowledged one at a time; individual JSON frames are capped at 1 MiB and queued controls/pre-listener output at 2 MiB. Output acknowledgements provide backpressure; oversized/invalid transport data or queue overflow terminates rather than silently retaining unbounded input. Transport failure closes helper stdin, then forces termination after 1 second. Helper EOF/malformed-input cleanup and process-group killing cover ordinary descendants, not descendants that deliberately escape the group (for example with `setsid`). This is not a sandbox or a cross-platform process-tree guarantee. Coverage: `tests/harness-terminal-helper.test.ts`, `tests/harness-terminal-cleanup.test.ts`, `tests/harness-terminal-plugin-route.ts`.

The helper pauses the process group with `SIGSTOP` while output is backpressured and resumes with `SIGCONT` when acknowledgements/drain permit. Backpressure stalled for 5 seconds triggers parent-loss cleanup rather than leaving the group paused indefinitely. Parent-loss cleanup sends `SIGCONT`/`SIGTERM`, then escalates to `SIGKILL` after 500 ms; the parent transport's 1-second fallback is a separate bound.

### Restart-durable tool finalization, not restart execution

Sources: `packages/server/src/tools/adapter/finalization-journal.ts`, `packages/server/src/runtime/persistence/tool-finalization-{journal,recovery,owners,fs}.ts`, and `packages/server/src/runtime/projects/{manager,recovery}.ts`. Coverage: `tests/harness-tool-finalization-durability.test.ts`.

- For absolute file-backed DBs, private files beside SQLite (`tool-journal/`) store fsynced/atomically replaced intent **before** execution, redacted outcome (including inline image bytes) **before** normal result finalization, and remove the record only after DB result commit. Failure to write intent prevents execution. No database schema/migration change is required; in-memory/non-file-backed DBs have no restart journal.
- Project open replays dead-owner journals in standalone/embedded and daemon modes. Daemon recovery also marks old pending assistant runs/running subagents interrupted. Recovery inserts results idempotently by part/call identity; it never reexecutes a mutation, publishes live events, resumes a model, or restores queued execution. A bare intent reports **outcome unknown**: a crash after an external effect but before durable outcome cannot establish whether the effect happened. Inspect state before retrying.
- Random owner identity plus conservative PID liveness skips live owners; PID reuse/permission uncertainty can delay recovery. This is a **single-host, same-user, shared PID namespace** contract, not safe distributed/shared-volume recovery across hosts or containers with independent PID namespaces.
- Project open must register its run-owner lease before recovery or project-scoped runtime allocation. Registration failure rejects the open rather than logging and continuing with unprotected work; the in-flight open entry is cleared so a later open can retry after permissions/storage are repaired. The shared cached DB handle may already exist, but no project runtime is allocated.
- Private `run-owners/` leases establish a safe interruption cutoff: rows must predate both daemon start and the oldest live foreign owner start. This relies on participating owners registering before writes and row timestamps not predating owner start. Unknown/malformed/unreadable leases, untrusted directories, live-owner temporary files and scan-limit uncertainty fail closed: marking is skipped until the ambiguous lease state is manually resolved. Journal replay has its own owner check and may still proceed.
- Directory operations validate ownership, private permissions, `O_NOFOLLOW|O_DIRECTORY` descriptors and dev/inode identity before/after access; record reads are bounded and nofollow. Node lacks `openat`, so a same-user directory swap away and back between checks remains outside the protection. Windows does not provide the same POSIX permission/nofollow contract.
- One journal record is capped at 64 MiB; each recovery pass inspects at most 10,000 directory entries. Corrupt records are quarantined for 7 days; unparseable temporary files age out after 24 hours, while parsed live-owner temps are retained. DB replay failure leaves records for a later pass; missing-message records are discarded. Outcomes exceeding the cap cannot be journaled and may leave an intent/unknown outcome after restart. Leases are capped at 4 KiB each and 1,024 entries per inspection. These bounds are not an unlimited-backlog or exactly-once external-effect guarantee.

## Validated incident: live image corruption

The live tool-event publisher bounds large payloads, including base64 image strings, and appends an omission marker. A truncated `read_image` payload can retain dimensions and metadata but is **not valid image bytes**. Rendering it as a data URL caused the live corruption; waiting for a final message refetch hid the problem rather than fixing the cause.

The renderer now refuses publisher-truncated or obviously short base64. The session stream refetches full persisted messages when tool results or transport payloads are marked truncated/omitted, even while the assistant is still Processing. Cache hydration preserves newer live parts. Sources: `packages/server/src/events/tool-payload.ts`, `packages/web-sdk/src/lib/read-image.ts`, `packages/web-sdk/src/hooks/sessionStreamEngine.ts`. `tests/harness-image-streaming-regression.test.ts` validates the publisher-to-stream/cache/renderer path, pending-message refetch, and preservation of new live parts. This validates the corruption/refetch regression, not native browser image decoding on every platform.

## Anthropic authentication contract

`packages/sdk/src/providers/src/anthropic-oauth-client.ts` distinguishes managed and standalone clients. Managed clients resolve stored auth through `getFreshAnthropicOAuth` in `packages/sdk/src/auth/src/anthropic-refresh.ts`. Refresh ownership uses the user-global secure auth lock and coordinated rereads/CAS persistence to handle rotation and logout; project roots do not turn stored Anthropic OAuth into independent per-project credentials.

Standalone/explicit-token clients use only the supplied token set and refresh it without reading or overwriting managed global auth. Request-scoped credentials must not silently fall back to a different managed identity. Coverage: `tests/harness-anthropic-auth-refresh.test.ts`, `tests/harness-anthropic-auth-persistence.test.ts`, `tests/harness-loop-anthropic-oauth.test.ts` and the focused legacy OAuth run.

## Acceptance blockers and follow-ups

1. The four requested continuation goals are implemented and reviewed with no remaining identified review blockers. Keep the upstream native Bun issue, platform/process-group limits, and scoped last lease-fix recheck explicit; do not imply the combined run was repeated after that fix.
2. Done: the agents credentials and Kimi reasoning baseline fixtures are reconciled without weakening production policy. The secure-home-dependent judge fixture is also isolated.
3. Done: default shared and independent split acceptance both completed 414 files, 2,829 passes, 0 failures, 3 skips, including `daemon-service`; generated CLI assets are a prerequisite. The seven cross-file failures were diagnosed and fixed, not hidden by isolation.
4. Recorded critical categories now have the code/test matrix above. The external original numbered P0 audit is unavailable, so exhaustive identity-level closure remains unproven.
5. Safely restart old daemons before relying on the SQLite registry lock. Old/new lock protocols do not coordinate; never assume the running old daemon already uses the upgrade.
6. Preserve the reviewed database public initialization contract, canonical SDK provider construction with server policy adapters, and shared shell lifecycle; these are implemented, not remaining extraction tasks.
7. Preserve reviewed journal crash boundaries, dead/live-owner handling and fail-closed lease registration/inspection. File-backed tool-result recovery is implemented; durable queued execution and automatic mutation replay remain deliberately unsupported.
8. Keep task boards, remote execution, unified capability indexing, async execution-driver contracts, durable queued-run envelopes, and instance-owned server runtimes in their future design discussions. ACP remote execution remains rejected until supported deliberately.

Exit criteria remain: named regressions for original P0s; lifecycle/adapter/project/ACP/outbox and actual SSE-byte integration coverage; fresh green lint/typecheck/completed relevant test runs; documented platform limitations; preserved public APIs unless a change is explicitly documented. The default shared and independent split acceptance evidence meets the recorded automated regression criteria; unavailable audit provenance and external/manual checks remain explicit limits.

## Related plans and boundary rules

This roadmap is the hardening follow-up to extraction work in [Runner/provider/tool refactor](runner-provider-tool-refactor.md), event/client work in [Cross-layer runtime consolidation](cross-layer-runtime-consolidation.md), project work in [Multi-project daemon migration](multi-project-daemon-migration.md), plugin work in [Plugin capabilities and commands](plugin-capabilities-and-commands.md), and [Patch tool failure analysis](patch-tool-failure-analysis.md). Their historical completion labels do not close the blockers above. [Remote agents](remote-agents.md) needs a separate design; swapping only a database accessor does not replace synchronous SQLite and in-memory queues.

Going forward: use project-scoped bus subscriptions and approvals, canonical resource keys and deduplicated initialization, acknowledged transactional durability, schema-derived event/outcome contracts, and focused SDK entrypoints. Root exports remain compatibility surfaces. A plan is complete only with named exit-criterion evidence and current implementation references, not file splitting or a partial test run.
