---
description: Set publish.env flags, commit, and push to trigger release
agent: composer
includeInHistory: false
---

Update `publish.env` for a publish run, then commit and push.

## Publish flags

Read `publish.env` first. Map recipe arguments (from `<recipe-arguments>`) to env vars and set each listed flag to `true`. Leave every other `PUBLISH_*` line unchanged.

| Argument | Variable |
| --- | --- |
| `cli` | `PUBLISH_CLI` |
| `desktop` | `PUBLISH_DESKTOP` |
| `canvas` | `PUBLISH_CANVAS` |
| `launcher` | `PUBLISH_LAUNCHER` |
| `ai-sdk` | `PUBLISH_AI_SDK` |

If there are no recipe arguments, enable **cli** and **desktop** only.

## Git

1. Stage only `publish.env`.
2. Commit with message exactly: `chore: publish and push`
3. Push the current branch to its upstream (`git push`).

If there is nothing to commit after editing, say so and still push if the user expects the branch on the remote.

Summarize which flags were set to `true` and the push result.
