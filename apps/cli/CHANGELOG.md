# @ottocode/cli

## 0.1.296

### Patch Changes

- Added session pinning support across the API, database, runtime, and web session list UI.

  Improved message thread performance with virtualized rendering support and added a performance optimization plan for future work.

  Improved simulator startup by waiting for localhost preview readiness before marking browser previews as connected.

  Tightened server route schemas and OpenAPI usage with more explicit Zod schemas for documented endpoints.

  Improved smart-edge hover handling so UI elements can opt out of right-rail hover behavior.

- Updated dependencies
  - @ottocode/database@0.1.296
  - @ottocode/server@0.1.296
  - @ottocode/acp@0.1.197
  - @ottocode/api@0.1.296
  - @ottocode/sdk@0.1.296
  - @ottocode/tui@0.1.1
