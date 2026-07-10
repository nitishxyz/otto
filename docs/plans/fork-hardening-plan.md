# AGI Fork Hardening Plan

Issues found and fixed in the redacted fork that also apply to this repo
(`agi`). Ordered by severity. Each section lists the affected files, the
symptom, and the fix as implemented in redacted so it can be ported directly.

Terminology mapping: redacted "matters" == agi "projects"
(`X-Redacted-Matter-Id` == `X-Otto-Project-Id`, `MatterManager` ==
`ProjectManager`).

---

## 1. Unknown project id silently falls back to `process.cwd()` (critical)

**Symptom (reported in the fork):** user creates project A, works in it,
creates project B — then message sends break and every session shows an
infinite loading state. Never self-heals.

**Root cause:** `packages/server/src/routes/project-context.ts`:

```ts
const runtime = await getProjectManager().getProject({
	id: projectId,
	// Compatibility-only fallback for legacy single-project server callers.
	path: projectPath || process.cwd(),
});
```

`getProject` tries the id first, but when the id is unknown (registry write
raced, daemon restarted, state evicted) it **falls through to the path** — the
daemon's cwd. The client is now silently talking to a different project's
SQLite database: its sessions don't exist there, message sends 404, SSE events
never arrive. The UI spins forever and keeps re-sending the same stale id.

Note: agi already guards the *contextless + daemon* case (400
`project_context_required`) — that guard stays. The missing piece is the
*unknown-id* case.

**Fix (as implemented in redacted):**

1. In `resolveRequestProject`: never pass a fallback path together with an id.

```ts
const runtime = projectId
	? await getProjectManager().getProject({
			id: projectId,
			path: projectPath || undefined,
		})
	: await getProjectManager().getProject({ path: fallbackRoot });
```

2. In `ProjectManager.getProject`: when an id was given and nothing matched,
   throw a 404 instead of falling through:

```ts
if (input.path) return this.openProject({ path: input.path });

if (input.id) {
	const error = new Error(`Project not found: ${input.id}`);
	(error as Error & { status?: number }).status = 404;
	throw error;
}

throw new Error('Project id or path is required');
```

3. Replace the cwd guess with an **explicit default root** registered at
   startup (see section 2). Contextless requests without a registered default
   hard-fail 400 in *all* modes, not just daemon mode.

**Regression test:** port `tests/multi-matter-flow.test.ts` from redacted
(rename matter→project). It drives the exact reported flow over HTTP: create
project A → session → message → terminal state; create project B → session →
subscribe SSE → message; assert terminal state, `message.created` on the
stream, session isolation, unknown-id 404, contextless 400/default resolution.

---

## 2. Replace cwd guessing with explicit default project root

**Principle:** every place that needs a fallback should hard-fail instead, so
routing bugs surface immediately. Where single-project serving is intentional,
the server registers its root **explicitly at startup**.

**Changes:**

- `packages/server/src/state.ts` — add:

```ts
let defaultProjectRoot: string | null = null;
export function setDefaultProjectRoot(root: string | null): void {
	defaultProjectRoot = root;
}
export function getDefaultProjectRoot(): string | null {
	return defaultProjectRoot;
}
```

- `resolveRequestProject` — contextless resolution order: explicit
  `project` path param/header → `getDefaultProjectRoot()` → **400**. Remove
  `process.cwd()` entirely.

- `apps/cli/src/commands/serve.ts`:
  - `handleServe`: `setDefaultProjectRoot(opts.daemonRegister ? null : opts.project)`
    (daemon mode stays strict; single-project serve registers its root).
  - `startApiServer`: `setDefaultProjectRoot(opts.project)`.

- CLI ephemeral ask server (`apps/cli/src/ask/server.ts`):
  `setDefaultProjectRoot(process.cwd())` before `createApp()` — explicit at the
  boundary, since the CLI's cwd *is* the user's project.

- Export `setDefaultProjectRoot`/`getDefaultProjectRoot` from
  `packages/server/src/index.ts`.

**Other cwd fallbacks to remove (hard fail):**

- `packages/server/src/runtime/ask/service.ts:111` —
  `request.projectRoot || process.cwd()` → require `projectRoot`, throw
  `AskServiceError('projectRoot is required for ask requests', 400)`.
- `packages/server/src/runtime/share/service.ts:35` —
  `args.projectRoot || process.cwd()` → make `projectRoot` required.

**Test-suite hygiene:** check for tests passing query params the resolver
ignores (in redacted, two suites passed `?project=` when the resolver only
read `matter`/`matterId` — they silently tested the cwd project). In agi the
param is `project` so this may be fine, but verify each test passes context
that the resolver actually reads, and fix any contextless
`/v1/auth/status`-style calls once strict mode lands.

---

## 3. No attachment limits on message send (event-loop stall / OOM)

**Symptom:** attaching many/large files to a chat message stalls the whole
daemon (single event loop + synchronous bun:sqlite). Measured in redacted with
a repro harness: a 119MB JSON body drove RSS 256MB → 3.6GB peak, 0.5–1.3s
event-loop stalls, and a >128MB body died with Bun's default
`maxRequestBodySize` as an **empty 413** the UI can't display — appears as
"stuck".

**Fix (port from redacted `packages/server/src/routes/session-messages.ts`):**

- Constants: `MAX_MESSAGE_ATTACHMENTS = 10`, `MAX_ATTACHMENT_BYTES = 5MB`,
  `MAX_TOTAL_ATTACHMENT_BYTES = 20MB`, `MAX_MESSAGE_REQUEST_BYTES = 64MB`.
- Early `Content-Length` check → JSON 413 before parsing the body.
- `validateMessageAttachments(body)` — walks `images` + `files`, estimates
  base64 bytes (`length * 0.75`) + `textContent` bytes, rejects per-file,
  total, and count violations with a clear JSON 413. Register a `'413'`
  response on the route schema.

**Client side (`packages/web-sdk/src/hooks/useFileUpload.ts`):**

- Default `maxSizeMB` 100 → **5**, add `maxTotalSizeMB = 20` cap across all
  staged files, per-file error toasts naming the rejected file.

**Repro/benchmark harness:** copy `scripts/repro-attachment-stall.ts` +
`scripts/repro-attachment-stall-server.ts` from redacted (fully isolated:
temp HOME, child process, external health probes measuring event-loop stalls,
RSS sampling via `/v1/debug/runtime`).

**Tests:** port `tests/message-attachment-limits.test.ts`.

---

## 4. listMessages response bloat (slow session loads)

**Symptom:** sessions containing attachments take seconds to load and hold the
event loop; response payload is ~2x the stored data.

**Root cause (`routes/session-messages.ts`, same code in both repos):**

1. Every part is emitted with BOTH the raw `content` string AND the parsed
   `contentJson` object — doubling the payload.
2. Inline base64 `data` / large `textContent` are returned even when the part
   references a stored attachment (`attachmentId`) that the client can fetch
   lazily from `/v1/attachments/{id}`.

**Fix (port `stripHeavyAttachmentFields` from redacted):** for `image`/`file`
parts that have an `attachmentId` AND an inline payload, strip
`data`/`textContent` from both `content` and `contentJson`, add
`dataOmitted: true`. Client falls back to the attachment URL for previews
(redacted change: `UserMessageGroup.tsx` builds
`/v1/attachments/{id}?project=...` src when inline data is absent).

This does not affect the model path: history building only inlines bytes for
the latest user image message; older parts already degrade to attachment-id
breadcrumbs.

---

## 5. Optional ports (evaluate)

- **DOCX support** — redacted added a minimal WordprocessingML text extractor
  (`fflate` unzip + `w:t` token walk, no heavy converter):
  `packages/server/src/runtime/sources/docx.ts` + chat attachment transform
  `runtime/message/docx-attachments.ts` (converts docx chat attachments to
  text at dispatch so the model sees content instead of a filename). Port the
  chat part if agi users attach docx files.
- **Directory drops** — `packages/web-sdk/src/lib/dropEntries.ts`
  (webkitGetAsEntry traversal, 200-file/8-depth caps) so dropping a folder
  attaches its files instead of silently doing nothing.

## Already present in agi (no action)

- `/v1/debug/runtime` diagnostics route and `scripts/daemon-doctor.ts`
- Global `onError` JSON handler (`initApp`) — verify it is applied to ALL app
  factories (`createStandaloneApp`, `createEmbeddedApp`), not just `initApp`
- Daemon-mode contextless guard in `resolveRequestProject` (keep; extend per
  section 2)
- Project-scope test suites (`daemon-project-guard`, `runtime-project-scope`,
  ...)

## Suggested order

1. Section 1 + 2 (routing correctness — the reported breakage)
2. Section 3 (limits — prevents daemon stalls)
3. Section 4 (payload bloat — fixes slow session loads for existing data)
4. Section 5 (optional)

Reference commits/files: everything above exists working in the redacted repo;
diff `packages/server/src/routes/project-context.ts`,
`routes/session-messages.ts`, `state.ts`, `runtime/matters/manager.ts`,
`apps/cli/src/commands/serve.ts`, and `tests/multi-matter-flow.test.ts`
against their agi counterparts.
