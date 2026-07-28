# Publishing Guide

This document describes the current release and npm publishing flow for the otto monorepo.

## Current publishing reality

There are two different publishing tracks in the repo:

1. **Main synchronized release track**
   - versioned together with the root/package workspace version
   - handled by `scripts/prepare-publish.ts`
   - published from the tag workflow
2. **Standalone package tracks**
   - managed by dedicated workflows and publish flags
   - versioned/published independently

## Main synchronized release track

` scripts/prepare-publish.ts ` currently prepares these packages for publish by replacing `workspace:*` dependencies with concrete versions:

- `packages/api` → `@ottocode/api`
- `packages/sdk` → `@ottocode/sdk`
- `packages/web-ui` → `@ottocode/web-ui`
- `packages/web-sdk` → `@ottocode/web-sdk`
- `packages/install` → `@ottocode/install`
- `packages/database` → `@ottocode/database`
- `packages/themes` → `@ottocode/themes`
- `packages/server` → `@ottocode/server`

It also collects version information for:

- `packages/ai-sdk` → `@ottocode/ai-sdk`

### Packages published in the tag workflow

`.github/workflows/publish-from-tag.yml` publishes these npm packages:

- `@ottocode/install`
- `@ottocode/api`
- `@ottocode/sdk`
- `@ottocode/themes`
- `@ottocode/web-sdk`
- `@ottocode/web-ui`
- `@ottocode/database`
- `@ottocode/server`

It also builds and attaches CLI binaries to the GitHub release.

## Standalone package tracks

These have dedicated publish workflows:

- `.github/workflows/publish-ai-sdk.yml` → `@ottocode/ai-sdk`

These are controlled via `publish.env` flags rather than the main tag workflow.

## Packages present but not part of the main tag publish flow

- `@ottocode/acp` — present in the repo, but not currently published by `publish-from-tag.yml`
- `@ottocode/ai-sdk` — separate workflow, not part of the main synchronized tag publish flow

## Release workflows

### `release.yml`

Main branch release automation.

What it does depends on flags in `publish.env`:

- checks publish flags for CLI / desktop / launcher
- bumps versions when needed
- builds CLI binaries
- builds desktop / launcher artifacts when enabled
- creates tags/releases for those surfaces

For the CLI path, it synchronizes versions across files including:

- root `package.json`
- `apps/cli/package.json`
- `packages/install/package.json`
- `packages/api/package.json`
- `packages/sdk/package.json`
- `packages/web-ui/package.json`
- `packages/web-sdk/package.json`
- `packages/database/package.json`
- `packages/themes/package.json`
- `packages/server/package.json`

### `publish-from-tag.yml`

Manual workflow-dispatch publishing from a tag like `v0.1.231`.

It:

1. checks out the tag
2. builds platform binaries for the CLI
3. creates a GitHub release
4. verifies synced package versions
5. runs `bun run scripts/prepare-publish.ts`
6. publishes the main synchronized npm packages listed above

### `publish-ai-sdk.yml`

Standalone workflow for `@ottocode/ai-sdk`.

Behavior:

- guarded by `PUBLISH_AI_SDK=true` in `publish.env`
- checks npm for an existing published version
- bumps patch if needed
- publishes to npm
- resets the publish flag and commits the version change

## Versioning model

### Synchronized packages

These should share the same version during the main release flow:

- root `package.json`
- `apps/cli/package.json`
- `packages/install/package.json`
- `packages/api/package.json`
- `packages/sdk/package.json`
- `packages/web-ui/package.json`
- `packages/web-sdk/package.json`
- `packages/database/package.json`
- `packages/themes/package.json`
- `packages/server/package.json`

### Separately versioned packages

These have their own publish/version path:

- `packages/ai-sdk/package.json`

## Manual release commands

### Prepare the API/client artifacts

If server routes changed:

```bash
bun run --filter @ottocode/api generate
```

### Replace workspace dependencies before publishing

```bash
bun run scripts/prepare-publish.ts
```

### Build/check before publishing

```bash
bun install
bun lint
bun test
bun run typecheck
```

## Required secrets

Repository workflows require:

- `NPM_TOKEN`
- `GITHUB_TOKEN` (provided by GitHub Actions for release jobs)
- Apple signing / notarization secrets for macOS artifact signing where applicable

## Practical guidance

- use the main synchronized flow for the core otto packages
- use the dedicated workflow for `@ottocode/ai-sdk`
- do not assume every public package in the repo is published by the same workflow
- if you change server APIs, regenerate `@ottocode/api` before tagging/publishing
- if you add a new public package, update both the docs and the relevant workflow/prepare script
