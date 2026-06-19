# Development

[← Back to README](../README.md) · [Docs Index](./index.md)

For deeper workflows and package-specific details, see [Development Guide](development-guide.md).

## Prerequisites

- [Bun](https://bun.sh)
- platform tooling required by the app you are working on (for example Tauri/mobile toolchains)

## Setup

```bash
git clone https://github.com/nitishxyz/otto.git
cd otto
bun install
```

## Core commands

```bash
bun lint
bun test
bun run typecheck
bun run compile
```

## Useful app/package dev commands

```bash
bun run dev:cli
bun run --filter @ottocode/tui dev
bun run dev:web
bun run dev:desktop
bun run --filter @ottocode/server dev
bun run --filter @ottocode/sdk dev
```

## SST / infra

Current `sst.config.ts` wires:

- `infra/script`
- `infra/landing`
- `infra/preview-api`
- `infra/preview-web`
- `infra/og`

Commands:

```bash
bun sst dev
bun sst deploy --stage prod
```

## Database workflow

```bash
bun run db:generate
bun run db:reset
```

For schema changes:

1. update schema files under `packages/database/src/schema/`
2. generate migrations with Drizzle
3. update `packages/database/src/runtime/migrations-bundled.ts`
4. test the migration locally

## API workflow

When changing server APIs:

1. update `packages/server/src/routes/`
2. update the route's Zod OpenAPI schemas registered with
   `zodOpenApiRoute(...)`
3. regenerate the client:

```bash
bun run --filter @ottocode/api generate
```

## Build targets

```bash
bun run build:bin:darwin-arm64
bun run build:bin:darwin-x64
bun run build:bin:linux-x64
bun run build:bin:linux-arm64
```

## Repo conventions

- use Bun for everything
- use Biome via `bun lint`
- use workspace imports for cross-package references
- keep changes focused and modular
- write tests for behavior changes
