# Cross-Layer Runtime Consolidation Plan

## Purpose

This plan coordinates a full cleanup pass across the Otto SDK, generated API client, server runtime, CLI, and daemon lifecycle. The work follows the same principle used for centralized image preparation: define one clear owner for shared policy, route all callers through it, and keep transport- or process-specific behavior in the correct layer.

The audit found both correctness defects and maintainability opportunities. Correctness and credential/process safety work comes first. Larger structural refactors follow only after shared contracts and regression coverage are stable.

## Goals

1. Fix identified credential, daemon lifecycle, project-context, remote-web, protocol, and public-export defects.
2. Establish canonical SDK-owned protocol and provider metadata where both server and clients need the same contract.
3. Remove route-to-runtime inversions and duplicated server transport mechanics.
4. Remove duplicated CLI command schemas, connection setup, server startup, network policy, and release identity logic.
5. Split oversized SDK modules only where responsibilities and tests provide clear seams.
6. Preserve existing public APIs unless a documented incorrect contract requires migration.
7. Add focused regression tests for every behavior change.

## Non-Goals

- No database schema migration unless a later implementation phase proves one is necessary.
- No live daemon restart, live database cleanup, or mutation of user project data as part of repository verification.
- No broad formatting-only changes.
- No compatibility aliases that silently map semantically different tools or protocols.
- No movement of Hono, process-management, or filesystem-server concerns into the SDK merely to create a generic abstraction.

## Dependency and Ownership Rules

The repository dependency direction remains:

```text
database/install -> sdk -> api -> server -> web-sdk -> apps
```

Shared code placement:

- SDK owns transport-neutral protocols, provider metadata, OAuth primitives, credential refresh coordination, release identity, and dependency-neutral retry/storage helpers.
- API owns client-side HTTP, SSE, and WebSocket consumption.
- Server owns Hono validation/serialization, SSE production, WebSocket ticket stores, attachment persistence, session repositories, and mutable HTTP auth-flow state.
- CLI owns command metadata, process spawning/signals, daemon registration, local network policy, and foreground/daemon orchestration.

No phase may introduce an SDK dependency on API, server, or CLI.

## Audit Summary

### Correctness and safety defects

1. API event types do not match the server SSE envelope or payload names.
2. Kimi token refresh bypasses the ownership-safe lock and compare-and-set persistence path.
3. `service restart` can race the old daemon on the fixed port.
4. `otto web --url` starts an unrelated local daemon despite requesting an existing remote API.
5. Project-scoped sessions/share commands can configure API headers for `process.cwd()` instead of `--project`.
6. Three public SDK export paths reference files that do not exist.
7. Token rotation can invalidate a live daemon classified as version-stale.
8. Lazy CLI command registration has drifted from executable command behavior and validation.
9. Many Zod-first routes ignore validated request values and parse requests again.
10. Server error schemas and runtime responses expose incompatible shapes.

### High-value consolidation seams

- Canonical event and dictation protocols.
- Provider descriptor table and generic model factory.
- OAuth PKCE/state/browser helpers.
- Credential refresh coordinator.
- Attachment persistence service.
- One-time audience-bound WebSocket ticket store.
- SSE producer and consumer lifecycle helpers.
- Generated API-backed daemon connection factory.
- Unified foreground/daemon server runtime.
- CLI network and port policy.
- SDK release/version identity.
- Provider retry/config primitives.
- Plugin subsystem split and shared skill frontmatter handling.
- Native-extension secret resolution.
- Atomic JSON object-file helpers.
- Expiring auth session store.
- Canonical session lookup/project-ownership service.

## Phase 1 — Immediate Correctness and Safety

Risk: high, but changes are bounded and regression-testable.

### 1A. Remote web and project context

Tasks:

- Ensure explicit `otto web --url` never starts or authenticates through a local daemon.
- Pass the requested project to sessions/share connection initialization.
- Add regression coverage for `cwd !== --project` and remote URL behavior.
- Prevent local daemon credentials from leaking into remote web context.

Primary files:

- `apps/cli/src/commands/web.ts`
- `apps/cli/src/commands/sessions.ts`
- `apps/cli/src/commands/share.ts`
- `apps/cli/src/ask/server.ts`
- `tests/cli-web-command.test.ts`

Exit criteria:

- Explicit remote web startup performs no local daemon operation.
- Header, query, and opened-project context agree for project-scoped commands.

### 1B. Credential refresh safety

Tasks:

- Add an internal OAuth refresh coordinator using the shared ownership-safe file lock.
- Preserve per-process in-flight deduplication.
- Re-read credentials after lock acquisition.
- Persist through compare-and-set and recover from compare-and-set loss.
- Migrate Kimi first, then OttoRouter if the shared coordinator is behavior-compatible.

Primary files:

- `packages/sdk/src/auth/src/file-lock.ts`
- `packages/sdk/src/auth/src/kimi-refresh.ts`
- `packages/sdk/src/auth/src/ottorouter-refresh.ts`
- new `packages/sdk/src/auth/src/refresh-coordinator.ts`

Exit criteria:

- Concurrent refresh cannot overwrite credentials rotated by another process.
- Stale lock recovery cannot delete a lock owned by a replacement process.

### 1C. Daemon restart and token safety

Tasks:

- Wait for process exit and failed authenticated health before removing daemon registration.
- Wait for port release before spawning a replacement.
- Reuse spawn/wait/identity primitives in normal and managed replacement flows.
- Separate process liveness, version compatibility, and identity status.
- Block token rotation whenever an authenticated live daemon exists.

Primary files:

- `apps/cli/src/daemon.ts`
- `apps/cli/src/commands/service.ts`
- `apps/cli/src/commands/serve.ts`
- new focused daemon process helper as appropriate

Exit criteria:

- Delayed shutdown cannot race restart on the same port.
- Registration remains until shutdown is confirmed.
- Live version-mismatched daemons cannot have credentials rotated underneath them.

### 1D. SDK export contract

Tasks:

- Investigate downstream use of stale `finish`, `grep`, and `plan` subpaths.
- Remove invalid entries or provide only semantically valid compatibility forwarders.
- Add a test that verifies every local package export target exists and can be imported.

Primary file:

- `packages/sdk/package.json`

Exit criteria:

- Every declared SDK export resolves under Bun and TypeScript.

## Phase 2 — Canonical Shared Contracts

Risk: high because these are public contracts.

### 2A. Event protocol

Create `@ottocode/sdk/events/protocol` containing:

- canonical event type union;
- typed payload map;
- generic event envelope;
- client event union;
- notification, session, reference, approval, tool, usage, and shell payload types.

Tasks:

- Migrate server event publishers and SSE encoding to the canonical types.
- Migrate API streaming parsing to return the real envelope.
- Preserve any required flattened API surface as explicit deprecated adapters.
- Cover `reference.preparation` and representative fixtures from every event family.

Exit criteria:

- Server-produced fixtures parse through API with matching compile-time and runtime fields.
- No independent handwritten API event union remains.

### 2B. Dictation protocol

Create `@ottocode/sdk/dictation/protocol` containing:

- audio format;
- client message union;
- server event union;
- error code union;
- default format constant;
- full discriminated runtime schemas.

Keep WebSocket ownership in API and transcription/session implementation in server.

Exit criteria:

- API and server import one protocol definition and reject malformed variants.

### 2C. Canonical API errors

Tasks:

- Define one Zod API error response schema adjacent to the server error implementation.
- Use one expected-error serializer and a central unexpected-error path.
- Treat unclassified exceptions as HTTP 500.
- Migrate route domains incrementally and regenerate API artifacts.
- Preserve explicitly intentional nonstandard domain envelopes only when documented.

Exit criteria:

- Generated response types describe runtime error bodies.
- Expected status/code failures and unexpected failures have stable tests.

## Phase 3 — SDK Policy Owners

### 3A. Provider descriptor table

Create one descriptor per built-in provider with:

- identity;
- default enablement/base URL;
- environment aliases;
- compatibility;
- prompt family;
- model policy;
- runtime kind.

Derive provider maps and ordinary model construction from this table. Keep specialized OAuth/proxy providers in focused adapters.

Exit criteria:

- Every built-in provider has one exhaustive descriptor.
- Custom provider resolution behavior is explicit and tested.

### 3B. OAuth primitives

Add focused internal modules for:

- PKCE pair creation;
- OAuth state creation;
- external URL opening without shell-string interpolation.

Migrate Claude, OpenAI, xAI, and Copilot flows.

### 3C. Retry/config policy

Extract dependency-neutral helpers for:

- integer setting parsing with explicit minimums;
- abort-aware delay;
- generic retry orchestration.

Reuse them in resilient fetch and provider token-refresh clients without hiding provider-specific transport behavior.

### 3D. Release identity

Create SDK functions for:

- strict release-version parsing;
- comparison;
- release asset selection;
- official release URL construction.

CLI installation and server staging remain separate.

## Phase 4 — Server and API Consolidation

### 4A. Zod-first route values

Migrate route handlers to `c.req.valid('json' | 'query' | 'param')` one domain at a time. Retain manual parsing only for multipart, binary, SSE, and WebSocket boundaries.

### 4B. Attachment service extraction

Move persistence, path confinement, filename normalization, hashing, limits, image preparation, and metadata I/O out of the HTTP route into a server runtime service. Keep multipart parsing and URL/HTTP response mapping route-local.

### 4C. One-time WebSocket tickets

Create an audience-bound one-time ticket store with subject, project/share bindings, expiry, injected clock, and atomic consumption. Migrate terminal and dictation tickets through thin audience-specific adapters.

### 4D. SSE lifecycle

Server helper responsibilities:

- headers;
- heartbeat;
- idempotent cleanup;
- abort/cancel handling;
- enqueue failures;
- backpressure closure.

API helper responsibilities:

- explicit HTTP method;
- status/body validation;
- chunk-boundary parsing;
- decoder flush;
- cleanup.

Replay and route-specific filtering remain outside generic helpers.

### 4E. Session repository and ownership

Create canonical lookup/require operations with project ownership and domain errors. Migrate mutations and security-sensitive operations before reads.

### 4F. Auth flow state

Create an expiring session store and provider-flow adapter for repeated device authorization orchestration. Keep mutable HTTP state server-local and provider protocol calls SDK-owned.

## Phase 5 — CLI and Daemon Consolidation

### 5A. Single-source command definitions

Replace lazy command re-registration and reconstructed argv with command definitions that lazy-load typed action handlers. Restore missing `service force-start` and make port validation identical between help registration and execution.

### 5B. Generated daemon API connection

- Ensure daemon/project routes are represented in OpenAPI.
- Regenerate `@ottocode/api`.
- Add one CLI daemon connection factory with standard authentication headers.
- Replace handwritten daemon paths, casts, and response parsing.

Registration files, spawning, and signals remain CLI-owned.

### 5C. Unified server runtime

Create one startup function for foreground and daemon modes that returns:

- normalized project configuration;
- listen and display URLs;
- web runtime state;
- idempotent shutdown.

Remove obsolete alternate startup paths only after checking external compatibility.

### 5D. Network and port policy

Centralize strict port parsing, `allowZero`, environment/flag precedence, loopback/listen host decisions, and URL construction in a CLI-local runtime module.

### 5E. Remove obsolete ephemeral lifecycle

Confirm external usage, then remove dead ephemeral-server functions and negative command-name cleanup lists. Prefer positive command metadata for connection requirements.

## Phase 6 — SDK Maintainability Cleanup

### 6A. Plugin subsystem split

Split the plugin monolith into:

- schema;
- config;
- discovery;
- registry;
- installation;
- source materialization;
- skill synchronization.

Move shared frontmatter parsing/mutation into the skills subsystem. Retain the plugin index as a compatibility barrel.

### 6B. Native-extension secrets

Centralize required/optional secret collection with injected environment input and consistent errors.

### 6C. Atomic JSON object files

Create low-level optional-object read and atomic JSON write helpers. Preserve tolerant config parsing, auth locking, permissions, and compare-and-set behavior.

### 6D. Dead abstractions

After migration and downstream checks, remove or deprecate:

- obsolete OpenAPI helper module;
- unused simplistic SSE parser;
- generated runtime-config no-op if not required;
- superseded startup functions;
- stale compatibility exports.

## Implementation Strategy

1. Implement phases in dependency order.
2. Delegate only non-overlapping file sets in parallel.
3. Give each batch explicit behavioral scope and required focused tests.
4. Do not mix credential/process safety changes with broad module splitting.
5. Move code before simplifying when extracting large modules.
6. Regenerate API artifacts only after intentional schema/protocol changes.
7. Preserve unrelated workspace changes.
8. Do not commit unless explicitly requested.

## Verification Matrix

Each batch must run focused tests. At phase boundaries run, as applicable:

```bash
bun lint
bun test
bun typecheck
bun run --filter @ottocode/sdk typecheck
bun run --filter @ottocode/api typecheck
bun run --filter @ottocode/server typecheck
bun run --filter @ottocode/cli typecheck
bun run --filter @ottocode/api generate
```

Known unrelated typecheck failures must be reported rather than hidden or broadened into unrelated fixes.

Final review must include:

- focused regression suites for every changed domain;
- package export resolution;
- OpenAPI/client regeneration cleanliness;
- dependency-cycle check;
- `git diff --check`;
- working-tree review that distinguishes pre-existing changes;
- confirmation that no live database or daemon state was mutated.

## Completion Checklist

- [x] Immediate CLI correctness fixes complete.
- [x] Credential refresh and daemon lifecycle races fixed.
- [x] SDK export contract valid.
- [x] Event and dictation protocols canonicalized.
- [x] API error shape canonicalized.
- [x] Provider/OAuth/retry/release policy centralized.
- [x] Zod-first handlers consume validated values.
- [x] Attachment, ticket, SSE, session, and auth-flow helpers extracted.
- [x] Lazy command duplication removed.
- [x] Daemon HTTP uses generated API operations.
- [x] Server startup and CLI network policy consolidated.
- [x] Plugin, secret, and JSON-file cleanup complete.
- [x] Dead abstractions removed after compatibility checks.
- [x] Explicit repository-scope and package-local desktop test suites green.
- [x] Focused tests, lint, typechecks, and final diff review complete.

## Status

- Audit: complete.
- Plan document: complete.
- Implementation: complete for Phases 1–6.
- Final integration verification: complete on 2026-08-18.

## Final Integration Verification — 2026-08-18

- `bun lint`: passed (2,028 files).
- `bun typecheck`: passed for all configured app and package workspaces,
  including SDK, API, server, CLI, web SDK, web, desktop-adjacent packages,
  database, and ACP. The landing workspace emitted one existing Astro hint and
  no errors or warnings.
- `bun run --filter @ottocode/api generate`: passed and produced no diff from
  the pre-generation workspace state.
- `bun test tests/sdk-export-contract.test.ts`: passed (1 test, 52 export
  assertions).
- Static import-boundary review found no SDK imports from API/server/CLI and no
  API source imports from server/CLI. The repository has no configured general
  dependency-cycle checker, so no broader automated cycle result is claimed.
- `git diff --check`: passed.
- Focused auth-flow verification passed after fixing an unbound
  `crypto.randomUUID` callback and restoring deterministic auth-session store
  cleanup/setup operations (`7 pass`, `0 fail` across OpenAI and GitHub device
  flow tests).
- Direct `bun test` discovered desktop tests that assume `apps/desktop` as the
  current directory; from the repository root they fail with `ENOENT` for
  package-relative fixture paths. The run completed with `1,726 pass`, `2 skip`,
  and `114 fail` across 303 files.
- The initial explicit repository-scope run (`bun test tests/*.test.ts
  packages/*/tests/*.test.ts`) completed with `1,830 pass`, `2 skip`, and `30
  fail` across 271 files. Classification and follow-up resolved 16 failures:
  10 consolidation integration failures (project-scoped event subscriptions,
  unsupported-provider status handling, and owned-session setup for secure
  input/plugin routes) and 6 stale expectations (retired catalog models,
  provider-specific Kimi catalog membership, current subagent guidance, and the
  moved TUI command registry). Production ownership and validation checks were
  retained rather than weakened.
- The shared-global interference was eliminated without serializing tests or
  changing production behavior. Compact-sidebar tests now create a fresh store
  after installing their storage shim, independent of an earlier module import.
  CLI web-command tests restore the original global `fetch` after each test and
  at suite teardown instead of leaving a `200 ok` mock installed for later real
  server tests. Adversarial ordering passed for both groups (`16 pass` for the
  sidebar import order and `14 pass` for CLI web followed by terminal/CLI
  runtime tests).
- The final explicit repository-scope run (`bun test tests/*.test.ts
  packages/*/tests/*.test.ts`) passed with `1,862 pass`, `2 skip`, and `0 fail`
  across 271 files (7,174 assertions).
- `bun test` from `apps/desktop` passed all package-local desktop tests (`116
  pass`, `0 fail` across 22 files). This confirms the root-discovery desktop
  `ENOENT` failures are current-directory harness issues, not desktop defects.
- Working-tree review found no API-generation churn, whitespace errors,
  newly-added broad casts, or debug-only artifacts. Pre-existing TUI changes in
  `apps/tui` were preserved. No live database or daemon state was mutated.
