# Project State Storage Migration Plan

## Goal

Make project `.otto/` commit-safe while preserving existing local data.

Project `.otto/` should contain only shareable project configuration such as agents, commands, tools, MCP definitions, and safe project defaults. Runtime data such as SQLite databases, attachments, debug logs, dumps, cache, and temporary files should move to per-project user storage outside the repository.

No auth/secrets migration is planned. Secrets are already stored via the existing secure auth path (`getSecureAuthPath()`), which resolves to OS-appropriate user state/application-support locations and writes with restrictive permissions.

## Current State

Existing behavior mixes config and runtime state in project `.otto/`:

- `packages/sdk/src/config/src/index.ts`
  - `dataDir = <project>/.otto`
  - `dbPath = <project>/.otto/otto.sqlite`
  - `projectConfigPath = <project>/.otto/config.json`
- `packages/server/src/routes/attachments.ts`
  - Stores attachments under `<project>/.otto/attachments`
- `packages/server/src/runtime/debug/turn-dump.ts`
  - Stores turn dumps under `<project>/.otto/debug-dumps`
- `apps/cli/src/gitignore.ts`
  - Auto-adds a blanket `.otto` ignore entry

Existing secure/auth behavior is already separated:

- `packages/sdk/src/auth/src/index.ts` uses `getSecureAuthPath()`
- macOS secure base: `~/Library/Application Support/otto`
- Linux secure base: `$XDG_STATE_HOME/otto` or `~/.local/state/otto`
- Windows secure base: `%APPDATA%/otto`

## Target Layout

### Repository-local project config

```txt
<project>/.otto/
  config.json
  agents/
  commands/
  tools/
  mcp.json
  .gitignore
```

These files are intended to be commit-safe. They should not contain secrets or personal runtime state.

### Per-project user state

Preferred simplified target:

```txt
~/.local/state/otto/projects/<project-id>/
  project.json
  migration.json
  otto.sqlite
  otto.sqlite-wal
  otto.sqlite-shm
  attachments/
  debug/
  debug-dumps/
  logs/
  tmp/
  cache/
  config.local.json
```

`config.local.json` is optional and reserved for future per-user project overrides that should never be committed.

### Project ID format

Use a readable slug plus short hash:

```txt
<project-basename>-<8-char-hash>
```

Example:

```txt
agi-a13f92c0
```

Recommended hash input:

1. Git remote URL, if available
2. Otherwise canonical real project path

Pseudo-code:

```ts
const slug = basename(projectRoot).replace(/[^a-zA-Z0-9._-]+/g, '-');
const hashInput = gitRemoteUrl ?? realpath(projectRoot);
const hash = sha256(hashInput).slice(0, 8);
const projectId = `${slug}-${hash}`;
```

This avoids collisions between multiple folders with the same name while keeping paths readable.

## New Path API

Add explicit path helpers in `packages/sdk/src/config/src/paths.ts`.

```ts
getOttoHomeDir(): string;
getProjectsStateRoot(): string;

getProjectId(projectRoot: string): Promise<string>;
getProjectConfigDir(projectRoot: string): string;
getProjectConfigPath(projectRoot: string): string;

getProjectStateDir(projectRoot: string): Promise<string>;
getProjectDbPath(projectRoot: string): Promise<string>;
getProjectAttachmentsDir(projectRoot: string): Promise<string>;
getProjectDebugDir(projectRoot: string): Promise<string>;
getProjectDebugDumpsDir(projectRoot: string): Promise<string>;
getProjectLogsDir(projectRoot: string): Promise<string>;
getProjectTmpDir(projectRoot: string): Promise<string>;
getProjectCacheDir(projectRoot: string): Promise<string>;

getLegacyProjectDataDir(projectRoot: string): string;
```

Keep `getLocalDataDir(projectRoot)` temporarily as a deprecated compatibility alias for legacy `<project>/.otto`, or remove once all internal callers have migrated.

## Config Shape Changes

Update `loadConfig()` so project config and project state are separate.

Target shape:

```ts
paths: {
  projectConfigDir: string;
  projectConfigPath: string | null;

  projectStateDir: string;
  dataDir: string; // temporary compatibility alias for projectStateDir
  dbPath: string;
  attachmentsDir: string;
  debugDir: string;
  debugDumpsDir: string;
  logsDir: string;

  globalConfigPath: string | null;
}
```

Project config should still be read from:

```txt
<project>/.otto/config.json
```

The SQLite DB should move to:

```txt
~/.local/state/otto/projects/<project-id>/otto.sqlite
```

## Runtime Storage Changes

### SQLite

Move from:

```txt
<project>/.otto/otto.sqlite
<project>/.otto/otto.sqlite-wal
<project>/.otto/otto.sqlite-shm
```

to:

```txt
~/.local/state/otto/projects/<project-id>/otto.sqlite
~/.local/state/otto/projects/<project-id>/otto.sqlite-wal
~/.local/state/otto/projects/<project-id>/otto.sqlite-shm
```

Affected areas:

- `packages/sdk/src/config/src/index.ts`
- `packages/database/src/index.ts`
- `packages/server/src/runtime/projects/registry.ts`
- `packages/server/src/routes/usage.ts`
- `packages/server/src/routes/sessions/service.ts`
- tests that assume `.otto/otto.sqlite`

### Attachments

Move from:

```txt
<project>/.otto/attachments/<attachment-id>/
```

to:

```txt
~/.local/state/otto/projects/<project-id>/attachments/<attachment-id>/
```

Update `packages/server/src/routes/attachments.ts` to use `cfg.paths.attachmentsDir` or a path helper instead of hardcoding `.otto/attachments`.

Future metadata should avoid project-relative `.otto` paths.

Preferred new metadata fields:

```json
{
  "storageRoot": "project-state",
  "relativePath": "attachments/att_x/original.png"
}
```

Legacy metadata with project-local runtime paths is migrated by `otto storage
migrate`; normal runtime should not resolve legacy project `.otto` attachment
paths after migration:

```json
{
  "originalPath": ".otto/attachments/att_x/original.png"
}
```

### Debug logs and dumps

Move from:

```txt
<project>/.otto/debug
<project>/.otto/debug-dumps
```

to:

```txt
~/.local/state/otto/projects/<project-id>/debug
~/.local/state/otto/projects/<project-id>/debug-dumps
```

Update `packages/server/src/runtime/debug/turn-dump.ts` to stop using `getLocalDataDir(projectRoot)` for dumps.

## Migration CLI

Add a small dev-facing command.

Recommended command group:

```bash
otto storage doctor
otto storage plan
otto storage migrate
otto storage migrate --dry-run
otto storage migrate --delete-legacy
otto storage migrate --project /path/to/project
```

Aliases are optional:

```bash
otto migrate-storage
otto dev migrate-storage
```

### `otto storage doctor`

Print current storage paths and migration status.

Example output:

```txt
Project root:        /Users/bat/dev/nitishxyz/agi
Project ID:          agi-a13f92c0
Project config dir:  /Users/bat/dev/nitishxyz/agi/.otto
Project state dir:   /Users/bat/.local/state/otto/projects/agi-a13f92c0
Database:            /Users/bat/.local/state/otto/projects/agi-a13f92c0/otto.sqlite
Attachments:         /Users/bat/.local/state/otto/projects/agi-a13f92c0/attachments
Debug dumps:         /Users/bat/.local/state/otto/projects/agi-a13f92c0/debug-dumps

Legacy project runtime data:
  .otto/otto.sqlite       found
  .otto/attachments       found
  .otto/debug             found
  .otto/debug-dumps       found

Status: migration recommended
Run:    otto storage migrate
```

### `otto storage plan`

Show exactly what would be copied or moved without touching files.

### `otto storage migrate --dry-run`

Same as plan, but through the migration execution path. Useful for testing.

### `otto storage migrate`

Copy legacy runtime artifacts into the new project state directory.

Default behavior should preserve legacy files. This is safest while validating the migration.

### `otto storage migrate --delete-legacy`

After successful copy and verification, remove legacy runtime files from project `.otto`.

This should only delete known runtime artifacts:

```txt
.otto/otto.sqlite
.otto/otto.sqlite-wal
.otto/otto.sqlite-shm
.otto/attachments
.otto/debug
.otto/debug-dumps
.otto/logs
.otto/tmp
.otto/cache
.otto/*.local.json
```

It must not delete:

```txt
.otto/config.json
.otto/agents
.otto/commands
.otto/plugins
.otto/mcp.json
.otto/.gitignore
```

## Migration Algorithm

1. Resolve project root.
2. Resolve legacy project data dir:

   ```txt
   <project>/.otto
   ```

3. Resolve target project state dir:

   ```txt
   ~/.local/state/otto/projects/<project-id>
   ```

4. Create target project state dir.
5. Write or update `project.json`:

   ```json
   {
     "id": "agi-a13f92c0",
     "name": "agi",
     "root": "/Users/bat/dev/nitishxyz/agi",
     "gitRemote": "git@github.com:nitishxyz/agi.git",
     "createdAt": "...",
     "lastSeenAt": "..."
   }
   ```

6. Copy SQLite files together, if present:

   ```txt
   otto.sqlite
   otto.sqlite-wal
   otto.sqlite-shm
   ```

7. Copy runtime directories, if present:

   ```txt
   attachments/
   debug/
   debug-dumps/
   logs/
   tmp/
   cache/
   ```

8. Verify copied files/directories exist.
9. Write `migration.json` manifest.
10. If `--delete-legacy` is provided, delete only known runtime artifacts.

## SQLite Safety

SQLite files should be copied as a group:

```txt
otto.sqlite
otto.sqlite-wal
otto.sqlite-shm
```

The migration command should warn if an Otto server is running or if the DB appears busy. For the first implementation, it is acceptable to print:

```txt
Stop any running Otto server before migrating SQLite data.
```

Recommended conservative behavior:

- Copy, do not move, by default.
- Do not overwrite an existing target DB unless `--force` is passed.
- If target DB exists, report `already exists` and skip unless forced.
- After copying, try opening the target DB through the existing database initialization path.

## Migration Manifest

Write a manifest to:

```txt
~/.local/state/otto/projects/<project-id>/migration.json
```

Example:

```json
{
  "version": 1,
  "projectRoot": "/Users/bat/dev/nitishxyz/agi",
  "projectId": "agi-a13f92c0",
  "migratedAt": "2026-06-15T00:00:00.000Z",
  "legacyDir": "/Users/bat/dev/nitishxyz/agi/.otto",
  "stateDir": "/Users/bat/.local/state/otto/projects/agi-a13f92c0",
  "items": [
    {
      "kind": "sqlite",
      "from": ".otto/otto.sqlite",
      "to": "~/.local/state/otto/projects/agi-a13f92c0/otto.sqlite",
      "status": "copied"
    },
    {
      "kind": "attachments",
      "from": ".otto/attachments",
      "to": "~/.local/state/otto/projects/agi-a13f92c0/attachments",
      "status": "copied"
    }
  ]
}
```

## Git Ignore Changes

Final behavior: do not auto-create `<project>/.otto/.gitignore`, do not
auto-add root `.otto` runtime ignore patterns, and stop auto-adding a blanket
`.otto` entry. Project `.otto/` now contains commit-safe config, agents, tools,
commands, and skills; runtime state lives under the project state directory.

Repositories may remove stale blanket/runtime `.otto` ignore entries after
migration. Cleanup of legacy runtime files is explicit via:

```sh
otto storage migrate --delete-legacy
```

For this repository, remove the stale root `.gitignore` entry:

```gitignore
.otto
```

and any stale legacy runtime patterns such as:

```gitignore
.otto/otto.sqlite*
.otto/attachments/
.otto/debug/
.otto/debug-dumps/
.otto/logs/
.otto/tmp/
.otto/cache/
.otto/*.local.json
```

## Compatibility Policy

Because this tool is currently single-user, breaking storage paths is acceptable.
Do not add legacy runtime fallbacks to normal runtime paths; use the explicit
migration command to preserve data during transition.

### DB

Prefer the new DB path. If legacy DB exists and new DB does not, show a clear warning:

```txt
Legacy Otto database found at .otto/otto.sqlite.
Run: otto storage migrate
```

Do not silently write new data to legacy DB.

### Attachments

New uploads should go to project state storage.

Reads should use new `relativePath` metadata under the project state directory.
Legacy `originalPath` metadata under project `.otto/attachments` should be
handled by migration, not by normal runtime fallback.

### Debug dumps

New dumps should go to project state storage. Do not add legacy runtime
fallbacks for old project `.otto` debug dumps.

## Project Registry Changes

Current registry stores `dbPath` pointing to project `.otto/otto.sqlite`.

Update project records to include state metadata:

```ts
interface RegisteredProject {
  id: string;
  name: string;
  path: string;
  stateDir: string;
  dbPath: string;
  firstSeenAt: number;
  lastSeenAt: number;
}
```

The registry should point to:

```txt
~/.local/state/otto/projects/<project-id>/otto.sqlite
```

not:

```txt
<project>/.otto/otto.sqlite
```

## Implementation Order

### Step 1: Path helpers

Add the new path helpers and tests. Do not change behavior yet except exposing new helpers.

### Step 2: Config paths

Update `loadConfig()` to separate project config and project state. Set `cfg.paths.dbPath` to the new state DB path.

### Step 3: DB migration command

Add `otto storage doctor`, `otto storage plan`, and `otto storage migrate` for SQLite files first.

### Step 4: Attachments

Update attachment storage to use project state dir. Extend migration command to copy attachments.

### Step 5: Debug storage

Move debug and debug-dump writes to project state dir. Extend migration command to copy debug directories.

### Step 6: Gitignore behavior

Stop blanket-ignore of `.otto`. Do not auto-create `.otto/.gitignore` and do
not auto-add root `.otto` runtime ignore patterns; helper logic may remove stale
blanket/runtime `.otto` ignore entries.

### Step 7: Tests and docs

Update existing path expectations and add migration coverage.

## Tests

Update existing tests:

- `tests/config.test.ts`
  - Stop expecting `.otto/otto.sqlite`
  - Assert project config remains under `<project>/.otto/config.json`
  - Assert DB path is under `~/.local/state/otto/projects/<project-id>/otto.sqlite` or `OTTO_HOME/projects/...`

Add tests for:

1. `loadConfig()` separates project config and state paths.
2. Project ID is stable for the same project root.
3. Migration dry-run detects legacy SQLite, attachments, debug, and debug-dumps.
4. Migration copies SQLite files without deleting legacy files by default.
5. `--delete-legacy` deletes only runtime artifacts.
6. `.otto/config.json` and `.otto/agents` survive migration.
7. New attachment uploads write to state dir.
8. Legacy attachment files are copied into project state by migration.
9. Project registry stores new `stateDir` and new `dbPath`.

## Non-goals

- Do not move provider secrets/auth.
- Do not redesign auth storage.
- Do not introduce sync/cloud storage.
- Do not migrate global config yet.
- Do not rewrite all attachment metadata in the first pass unless required.

## Success Criteria

- Running Otto in a repo no longer creates SQLite DBs, attachments, or debug dumps inside project `.otto`.
- Project `.otto` can be committed with agents and config.
- Existing data can be preserved with `otto storage migrate`.
- Legacy runtime files can be cleaned with `otto storage migrate --delete-legacy`.
- Tests pass with Bun.

## Implementation Status

Implemented in the project state storage migration pass:

- Added explicit SDK path helpers for project config/state paths, `OTTO_HOME`, stable project IDs, and legacy project data aliases.
- Updated `loadConfig()` so project config remains in `<project>/.otto/config.json` while runtime state paths (`dataDir`, `dbPath`, attachments, debug, logs, tmp, cache) resolve under `~/.local/state/otto/projects/<project-id>` or `OTTO_HOME/projects/<project-id>`.
- Added storage CLI commands: `otto storage doctor`, `otto storage plan`, and `otto storage migrate` with `--dry-run`, `--delete-legacy`, `--project`, and `--force`.
- Storage migration now covers SQLite files, attachments, debug/runtime directories, project metadata (`project.json`), and migration manifests (`migration.json`). Legacy files are preserved by default and `--delete-legacy` removes only known runtime artifacts after successful copy/verification.
- New attachments write to project state storage with `storageRoot: "project-state"` and `relativePath`; legacy attachment data is handled by `otto storage migrate`, not normal runtime fallback.
- Turn debug dumps write to project state `debug-dumps`, and the project registry records stable project IDs, `stateDir`, and state DB paths.
- Git ignore behavior no longer blanket-ignores `.otto`, does not auto-create project `.otto/.gitignore`, and does not auto-add root `.otto` runtime patterns. Helper behavior may remove stale blanket/runtime `.otto` ignore entries.

Focused coverage added/updated in:

- `tests/config.test.ts`
- `tests/storage-migration.test.ts`
- `tests/attachments-storage.test.ts`
- `tests/turn-dump.test.ts`
- `tests/project-registry.test.ts`
- `tests/gitignore.test.ts`
