# Database configuration boundary

`@ottocode/database` opens SQLite paths and applies bundled migrations. It does not
load SDK configuration, choose a project directory, or import the SDK logger.

Callers that already loaded configuration should use `getDbForConfig(cfg)`; its
contract only requires `{ paths: { dbPath: string } }`. Path-owning callers and
workers can use `getDbByPath(path)`. Both preserve the existing connection cache
and `getDbFilePath` worker lookup.

The legacy `getDb(projectRoot?)` accessor uses a host-registered
`setDatabasePathResolver` callback. Importing `@ottocode/sdk/config` (also exported
by the SDK root) explicitly registers `resolveDatabasePath`, which delegates to
`loadConfig` and retains its existing directory creation, migration, and default
project policy. Database-only applications must register their own resolver or
use a path-based accessor. Without initialization, `getDb` rejects rather than
silently selecting storage in the current working directory.

The persisted cache-usage normalization marker lives in
`@ottocode/database/markers`. Its value remains unchanged so existing migration
and backfill classification is preserved. Schema and bundled migrations are
unchanged by this boundary extraction. The SDK providers entrypoint re-exports
this authoritative marker; the persisted value remains
`cache_usage_normalization_v2_enabled`.

The Database -> SDK import-direction exemption has been removed from
`tests/harness-boundary-imports.test.ts`. The separate private Astro preview
source-import exemption remains. `tests/harness-database-boundary.test.ts`
covers the path/config accessors and legacy host initialization contract.
Database-only `getDb` consumers must initialize a resolver before their first
call; importing only the database package is no longer sufficient.

Restart-durable tool finalization uses private files beside an absolute
file-backed database, not new tables or migrations. The journal is a server
persistence concern and does not introduce a database dependency on SDK/server.
See the [Harness reliability roadmap](plans/harness-reliability-roadmap.md)
for recovery ownership, crash-window and filesystem limits. These boundary and
recovery changes are implemented and independently reviewed, subject to those
limits. Server project opening rejects if its run-owner lease cannot register,
before recovery or project-scoped runtime allocation; this does not change the
standalone database accessor contract. The final lease fix received a scoped
recheck, not another full combined rerun. Two archived-HEAD baseline failures
remain and the full repository suite is not complete or green.
