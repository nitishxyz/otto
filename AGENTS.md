# otto Agent Guide

Use this file as a map, not a manual. Read the relevant code and linked docs before changing behavior.

## Priorities

- Make the smallest correct change; preserve public APIs and unrelated work.
- Use strict TypeScript, existing patterns, focused modules, and no circular dependencies.
- Use Bun only: never npm, yarn, or pnpm.
- Do not commit unless explicitly asked.
- Update tests and docs when behavior changes.

## Repository Map

```text
otto/
├── apps/
│   ├── cli/          command-line entrypoint and daemon management
│   ├── desktop/      Tauri desktop shell
│   ├── tui/          terminal UI; consumes @ottocode/api
│   ├── web/          web client
│   └── landing/      public site and generated model catalog
├── packages/
│   ├── database/     SQLite, Drizzle schemas, migrations
│   ├── sdk/          core agents, tools, auth, config, providers, prompts
│   ├── api/          generated type-safe API client
│   ├── server/       Hono routes and runtime orchestration
│   ├── web-sdk/      shared React components, hooks, and stores
│   └── web-ui/       prebuilt static web assets
├── tests/            Bun integration/regression tests
├── scripts/          build, catalog, and maintenance scripts
├── docs/             architecture, development guides, and plans
└── .otto/            project-local agent/tool/config overrides
```

Dependency direction: `database/install → sdk → api → server → web-sdk → apps`. See `docs/architecture.md`; do not introduce cycles.

## Commands

- Install/run/build/test with Bun.
- Lint and format: `bun lint`; fix formatting with `bun lint --fix`.
- Tests: `bun test` or a focused `bun test tests/<name>.test.ts`.
- Typecheck: `bun typecheck` or a focused workspace filter.
- Build binary: `bun run build`.
- Before finishing: run focused tests, `bun lint`, and inspect the working tree.

Tests use `bun:test`, live under `tests/`, and end in `.test.ts`.

## Code Conventions

- Cross-package imports use `@ottocode/...`; imports within a package are relative. Never use `@/` aliases.
- Keep files focused; consider splitting modules beyond roughly 200–300 lines.
- Prefer explicit types and schemas. Avoid `any`; explain unavoidable uses.
- Add concise JSDoc to exported functions when their contract is not obvious.
- Do not add compatibility layers, comments, or abstractions without a concrete need.
- Use conventional commit prefixes if asked to commit: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## High-Risk Workflows

### Generated files

Never hand-edit generated catalogs:

- `packages/sdk/src/providers/src/catalog.ts`
- `packages/ai-sdk/src/catalog.ts`
- `apps/landing/public/catalog/models.json`

Regenerate with `bun run scripts/update-catalog.ts` (`--ottorouter` when applicable).

### Database

Schemas live one table per file in `packages/database/src/schema/`.

1. Update the schema.
2. Run `bunx drizzle-kit generate`; never create migrations manually.
3. Update `packages/database/src/runtime/migrations-bundled.ts`.
4. Test the migration locally.

### API/server

Routes live in `packages/server/src/routes/` and are Zod-first.

1. Define explicit request/response schemas with Zod/`@hono/zod-openapi`.
2. Register documented endpoints with `zodOpenApiRoute(...)`.
3. Keep non-Zod exceptions narrow (WebSocket, SSE, binary, or multipart edges).
4. Regenerate OpenAPI and the client: `bun run --filter @ottocode/api generate`.
5. First-party clients use `@ottocode/api`, not duplicated URLs or response types.

### AI runtime

- Use AI SDK v6 APIs and keep provider switching in the SDK.
- Agents/tools are modular; defaults live under `packages/sdk/src/`, with project overrides under `.otto/`.
- Streaming uses SSE where appropriate.
- OttoRouter authentication is configured through `otto auth login ottorouter` or `OTTOROUTER_PRIVATE_KEY`.

### Frontend performance

- Parents/layouts own structure, not child feature state.
- Subscribe only to state needed by the current component; use narrow Zustand selectors.
- Mount expensive panels/modals only when visible.
- Compute shared list state once; avoid per-row global subscriptions.
- Preserve the existing design system and responsive behavior.
- For performance work, follow `docs/plans/react-performance-optimization-plan.md` and verify with React Scan when possible.

## Documentation

Documentation belongs in `docs/`; the root contains only `README.md`, `AGENTS.md`, `LICENSE`. Start with `docs/index.md` and `docs/development.md`.
