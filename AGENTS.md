# otto Project - AI Agent & Contributor Guidelines

This file defines conventions for AI agents and human contributors working in this repository.

## Formatting and Linting

- Use Biome for linting/formatting: `bun lint`
- Do not disable rules globally
- If an exception is required, limit scope and add rationale in PR/commit message
- Keep imports sorted and remove unused code

## Modular Structure

- Prefer many small, focused modules over large files
- One route module per endpoint group (or per endpoint if it grows)
- One schema/table per file under `packages/database/src/schema/`, re-exported via index
- Keep `apps/tui` focused on interactive terminal UX and use `@ottocode/api` for server calls
- Avoid circular dependencies
- If a module grows beyond ~200–300 lines, consider refactoring

## Frontend Performance Boundaries

- Keep React parent/layout components focused on structure, not feature-specific state.
- A component should only subscribe to stores, queries, and hooks needed to render its own immediate output.
- If a dependency is only needed by a child panel, modal, list row, or controller, move that dependency into that child.
- Do not run expensive hooks before visibility gates. Use lightweight wrappers for hidden panels/modals and mount the heavy content only when visible.
- Prefer narrow Zustand selectors for exact values/actions; avoid subscribing to broad objects such as full store slices or all panel widths when only one value is needed.
- Avoid per-row global store subscriptions in large lists. Compute shared state once in the parent and pass stable props to memoized rows.
- Gate closed modals instead of always rendering them with `isOpen={false}` when the modal wrapper does non-trivial work.
- For frontend performance work, follow the plan in [docs/plans/react-performance-optimization-plan.md](docs/plans/react-performance-optimization-plan.md) and verify changes with React Scan where possible.

## Monorepo Package Imports

Use workspace package imports for cross-package dependencies:

- `@ottocode/api` - Type-safe API client
- `@ottocode/database` - SQLite + Drizzle ORM
- `@ottocode/install` - npm installer package
- `@ottocode/sdk` - Core SDK (tools, streaming, agents, auth, config, providers, prompts)
- `@ottocode/server` - HTTP server
- `@ottocode/web-sdk` - React components, hooks, and utilities
- `@ottocode/web-ui` - Pre-built static web UI assets

**Import Rules:**

- Use workspace imports (`@ottocode/...`) for cross-package dependencies
- Use relative imports (`./`, `../`) within the same package only
- **Never use `@/` path aliases** (removed during monorepo migration)

## Runtime and Tooling

- Use Bun for everything: scripts, running, building, testing, linting
- Do not use npm/yarn/pnpm commands
- Tests must use `bun:test` and live in `tests/`

## Database and Migrations

- SQLite via Drizzle ORM
- Schema lives under `packages/database/src/schema/`
- Migrations generated with Drizzle Kit into `packages/database/drizzle/`
- Server ensures database exists and runs migrations on startup

**Migration Workflow:**

When you need schema/database changes:

1. Update the schema files in `packages/database/src/schema/`
2. Generate migrations: `bunx drizzle-kit generate`
3. Update `packages/database/src/migrations-bundled.ts` to include the new migration file
4. Test the migration locally before committing

**Never manually create migration files** - always use `bunx drizzle-kit generate`

## API and Server

- Hono-based app
- Each endpoint belongs in its own module under `packages/server/src/routes/`
- Endpoint contracts must be Zod-first: define request params/query/body and response schemas with `@hono/zod-openapi`/Zod in server route/schema modules, then derive OpenAPI from those schemas.
- Do not hand-write OpenAPI schema objects as the source of truth for normal JSON endpoints. If an endpoint truly cannot be represented by Zod/OpenAPI (for example raw WebSocket upgrade handling, SSE helpers, binary file responses, or multipart edge cases), keep the exception narrow and document why in the route module.
- Expose OpenAPI at `/openapi.json` from registered server routes; do not maintain a separate hardcoded spec file.
- Streaming uses SSE; prefer AI SDK helpers for stream responses
- For API changes, follow this order:
  1. Implement/update route methods in `packages/server/src/routes/`
  2. Add/update Zod OpenAPI schemas alongside the route
  3. Regenerate OpenAPI JSON + SDK: `bun run --filter @ottocode/api generate`
- All first-party clients (web, desktop, tui, cli, acp) should consume `@ottocode/api`; avoid direct `fetch` calls to otto endpoints when SDK methods exist

## AI SDK and Agents

- Use AI SDK v5 APIs (`generateText`, `streamText`, `generateObject`, `streamObject`, `tool`, `embed`, `rerank`)
- Support provider switching via SDK (OpenAI, Anthropic, Google, OpenRouter, OpenCode, OttoRouter)
- OttoRouter uses Solana wallet auth — store the base58 private key with `otto auth login ottorouter` or via `OTTOROUTER_PRIVATE_KEY`
- Agents and tools are modular
- Load defaults from `packages/sdk/src/tools/`
- Allow project overrides under `.otto/`

## Commits and Changes

- Make minimal, focused changes
- Avoid unrelated refactors
- Keep filenames, public APIs, and structure stable unless change is required
- Use conventional commit format:
  - `feat:` - New features
  - `fix:` - Bug fixes
  - `docs:` - Documentation changes
  - `refactor:` - Code refactoring
  - `test:` - Test additions/changes
  - `chore:` - Maintenance tasks

## Package Development

Each package under `packages/` should have:

- Clear single responsibility
- Proper exports in `package.json`
- `tsconfig.json` extending `../../tsconfig.base.json`
- `README.md` for public packages (sdk, server, web-ui)

**Dependency Rules:**

- Follow dependency graph levels documented in [docs/architecture.md](docs/architecture.md)
- No circular dependencies between packages
- Level 0 (no deps): database, install
- Level 1: sdk (standalone - includes auth, config, providers, prompts)
- Level 2: api (standalone API client)
- Level 3: server (depends on sdk, database)
- Level 4: web-sdk (depends on api)
- Level 5: cli (depends on sdk, server, database)

## Documentation

- All documentation lives in `docs/`
- Root level contains only: `README.md`, `AGENTS.md`, `LICENSE`
- Update docs when changing behavior
- Keep examples up to date
- See [docs/index.md](docs/index.md) for documentation overview

## TypeScript

- Always use TypeScript strict mode
- Add JSDoc comments to exported functions
- Prefer functional programming patterns where appropriate
- No `any` types unless absolutely necessary (add comment explaining why)

## Testing

- Write tests for new features and bug fixes
- Use Bun test framework (`bun:test`)
- Tests live in `tests/` directory
- Test files end with `.test.ts`
- Run tests: `bun test`

## Code Review

- Keep PRs focused on a single change
- Write clear PR descriptions
- Link related issues
- Respond to review comments promptly
- All CI checks must pass before merge

## AI Agent Specific Guidelines

If you're an AI agent (like Claude) contributing to this project:

- **Always read this file first** before making changes
- Follow all conventions strictly
- Ask for clarification if rules conflict or are unclear
- Prefer smaller, incremental changes over large refactors
- Test changes thoroughly before committing
- **Do not commit changes without explicit permission**
- When making multiple related changes, ask if you should commit after each logical step

## Getting Help

- Check [docs/](docs/) for detailed documentation
- See [docs/architecture.md](docs/architecture.md) for system design
- See [docs/development.md](docs/development.md) for development workflow
- Search existing issues before creating new ones

## Summary

The key principles for contributing to otto:

1. **Modular** - Small, focused files and packages
2. **Type-safe** - TypeScript strict mode everywhere
3. **Tested** - Write tests for new features
4. **Documented** - Update docs when changing behavior
5. **Consistent** - Follow existing patterns and conventions
6. **Bun-first** - Use Bun for all tooling and runtime
7. **Minimal changes** - Keep PRs focused and atomic
