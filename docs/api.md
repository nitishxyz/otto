# API

[← Back to README](../README.md) • [Docs Index](./index.md)

The otto server exposes a generated OpenAPI document and a versioned HTTP API.

Default local clients talk to a shared daemon. Daemon requests use a local token, sent as `Authorization: Bearer <token>` and/or `X-Otto-Server-Token: <token>`.

## Source of truth

Use these in order:

1. `packages/api/openapi.json`
2. `GET /openapi.json`
3. `@ottocode/api`

Do not treat this page as a complete route listing; it is a guide to the current API shape.

## Base routes

- `GET /` — simple root response (`otto server running`)
- `GET /openapi.json` — generated OpenAPI spec
- `GET /v1/server/info` — server metadata and runtime info

Operational routes live under **`/v1/*`**.

## Main route groups

The current OpenAPI spec exposes route groups including:

- `ask`
- `auth`
- `config`
- `doctor`
- `files`
- `git`
- `mcp`
- `projects`
- `provider-usage`
- `research`
- `sessions`
- `ottorouter`
- `shares`
- `skills`
- `terminals`
- `tunnel`

## Representative routes

### Projects

- `GET /v1/projects` — list open and known projects
- `POST /v1/projects/open` — open a project runtime from `{ "path": "/absolute/path" }`
- `GET /v1/projects/{projectId}` — get an open or known project
- `DELETE /v1/projects/{projectId}` — forget a known project without deleting files
- `DELETE /v1/projects/{projectId}/close` — close an open project runtime
- `POST /v1/projects/{projectId}/touch` — update last-used time for an open runtime

Project summaries include `id`, `name`, `path`, `stateDir`, `dbPath`, `lastUsedAt`, and `open`.

### Ask

- `POST /v1/ask`

### Sessions

- `GET /v1/sessions`
- `POST /v1/sessions`
- `GET /v1/sessions/{sessionId}`
- `POST /v1/sessions/{id}/messages`
- `GET /v1/sessions/{id}/stream`
- `POST /v1/sessions/{sessionId}/abort`
- `POST /v1/sessions/{sessionId}/branch`
- `POST /v1/sessions/{sessionId}/share`

`POST /v1/sessions/{id}/messages` accepts optional file context that is read
from the target project before the assistant starts:

```json
{
  "content": "Update the implementation using these references.",
  "context": {
    "files": [
      { "path": "packages/sdk/src/example.ts" },
      { "path": "tests/example.test.ts", "startLine": 20, "endLine": 80 }
    ]
  }
}
```

The server resolves these references concurrently and appends each as a
synthetic `read` tool call/result pair at the active conversation tail. A
maximum of 20 files and 2 MiB of serialized read results can be preloaded per
message. `endLine` and `maxLines` require `startLine`; when both are supplied,
`endLine` takes precedence. Identical references in one request are read once, and normal history
compaction keeps only the latest read of the same path and range in model
context. Missing files are preserved as normal read errors so the agent can
recover with its own tools.

Existing project files mentioned in message text with `@path`, such as
`Review @packages/server/src/index.ts`, enter the same preload pipeline. Agent,
skill, reference, missing-file, and ordinary `@` tokens are left alone. Small
mentioned files are available before the first model inference; mentions that
exceed the automatic mention budget keep the bounded inline fallback rather
than rejecting the message.

The message UI collapses these synthetic reads into the normal grouped tool
activity presentation, showing paths, bytes, preload duration, and removed
duplicate references. Server telemetry records preload duration, time to the
first assistant text/tool activity, and any agent-initiated reread of an
identical preloaded range.

### Config

- `GET /v1/config`
- `GET /v1/config/defaults`
- `GET /v1/config/providers`
- `GET /v1/config/models`
- `GET /v1/config/agents`

### Files

- `GET /v1/files`
- `POST /v1/files/read`
- `POST /v1/files/tree`

### Git

- `GET /v1/git/status`
- `POST /v1/git/diff`
- `POST /v1/git/commit`
- `POST /v1/git/stage`
- `POST /v1/git/unstage`
- `POST /v1/git/push`
- `POST /v1/git/pull`

### Auth

- `GET /v1/auth/status`
- `POST /v1/auth/{provider}`
- `POST /v1/auth/{provider}/oauth/start`
- `POST /v1/auth/{provider}/oauth/exchange`
- `GET /v1/auth/{provider}/oauth/callback`

### Terminals

- `GET /v1/terminals`
- `POST /v1/terminals`
- `GET /v1/terminals/{id}`
- `POST /v1/terminals/{id}/input`
- `GET /v1/terminals/{id}/output`

### Skills

- `GET /v1/skills`
- `GET /v1/skills/{name}`
- `GET /v1/skills/{name}/files`
- `GET /v1/skills/{name}/files/{filePath}`
- `POST /v1/skills/validate`

## SSE streaming

Streaming is used for ask/session workflows. The most important stream route is:

- `GET /v1/sessions/{id}/stream`

Common event types include:

- `assistant.delta`
- `assistant`
- `tool.call`
- `tool.result`
- `tool.approval.required`
- `finish-step`
- `usage`
- `error`

Exact event payloads should be derived from the OpenAPI/client implementation rather than copied manually into downstream apps.

## Project context

Most operational routes are project-scoped. First-party clients should send the stable project id returned by `POST /v1/projects/open`:

```txt
GET /v1/sessions?projectId=<project-id>
GET /v1/sessions/{id}/stream?projectId=<project-id>
X-Otto-Project-Id: <project-id>
```

Compatibility path-based context is still supported:

```txt
GET /v1/sessions?project=/absolute/project/path
X-Otto-Project: /absolute/project/path
```

`?project=` remains useful for scripts and old clients. New code should prefer `projectId` once a project is opened. When both id and path forms are present, `projectId` / `X-Otto-Project-Id` wins. Requests without project context use only the centralized compatibility fallback in `packages/server/src/routes/project-context.ts`; route handlers should not call `process.cwd()` directly.

`OTTO_SERVER_URL` remains supported for clients that point at an existing server. Those clients still need to open/select a project with `POST /v1/projects/open` and send project context through query parameters or headers.

## Client guidance

If you are building a first-party or external client:

- prefer `@ottocode/api` over handwritten `fetch`
- treat `/openapi.json` as the authoritative contract
- assume versioned operational routes are under `/v1/*`
- call `POST /v1/projects/open` before project-scoped workflows
- include daemon token headers when talking to the local daemon
