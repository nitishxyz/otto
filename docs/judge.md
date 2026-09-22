# Judge (TypeSafe)

[← Back to docs](index.md)

The judge is an optional, non-chat model that otto asks small, typed questions.
It never writes text or picks what the agent does; code asks it a question with
a fixed answer space and gets back a calibrated answer. otto currently supports
[TypeSafe](https://typesafe.ai) System One models (`jev-latest`).

If no judge is configured, everything described here is skipped and otto
behaves exactly as before.

## What it powers

### MCP tool safety classification

MCP servers rarely annotate their tools, so otto cannot tell `github__list_issues`
from `github__delete_repository`. Without a classification, MCP tools auto-run in
the default `toolApproval: "dangerous"` mode.

With a judge, otto classifies each MCP tool once, when its server connects:

1. If the server sends MCP `annotations` (`readOnlyHint`, `destructiveHint`),
   those win and the judge is not called.
2. Otherwise the judge is asked, in one batched request, what invoking the tool
   does (`read_only`, `local_write`, `external_write`, `destructive`) and
   whether a mistaken call would be hard to undo.
3. Policy is applied in code: low-confidence writes are treated as external
   writes; likely-irreversible writes are treated as destructive.

The result is attached to the tool as `effects` metadata, the same vocabulary
plugin tools use, so the existing approval logic prompts for writes and stays
silent for reads. The tool catalog marks classified writes as `risky`.

Effect on each `toolApproval` mode:

| Mode | Classified read-only | Classified write | Unclassified MCP tool |
| --- | --- | --- | --- |
| `auto` / `yolo` | runs | runs | runs |
| `dangerous` | runs | prompts | runs (as today) |
| `all` | runs | prompts | prompts (as today) |

Results are cached in `~/.local/state/otto/cache/mcp-tool-classifications.json`
keyed by server, tool name, and a hash of the description and input schema. A
tool is re-judged only when its contract changes.

### MCP tool pre-activation

otto activates MCP tools lazily: the model reads a catalog embedded in the
`load_mcp_tools` tool and spends a step loading what it needs.

With a judge, otto asks, per user turn, whether each MCP tool is plausibly
needed for the request. Tools above the threshold are active on step 1 and the
`load_mcp_tools` catalog switches to a compact form: pre-loaded tools with
descriptions, every other tool by name only. The model can still load any tool
by name, so a miss costs one step, not a capability.

The pre-selection runs concurrently with prompt composition and is capped at
1.5 seconds. On timeout or error the turn proceeds without pre-loads.

## Setup

```bash
otto auth login typesafe
```

Or set `TYPESAFE_API_KEY` in your environment, or paste the key under
**Settings → Automation → Judge Model** in the web/desktop UI. Credentials are
stored in the secure auth file under `typesafe` and listed by `otto auth list`.
The judge does not appear in the model picker.

The same settings panel exposes every option below; changes apply on the next
tool discovery without a restart.

## Configuration

Add a `judge` section to `~/.config/otto/config.json` (project `.otto/config.json`
overrides are also honored):

```json
{
  "judge": {
    "enabled": true,
    "provider": "typesafe",
    "baseURL": "https://api.typesafe.ai",
    "model": "jev-latest",
    "timeoutMs": 4000,
    "mcp": {
      "classifyTools": true,
      "preloadTools": true,
      "preloadThreshold": 0.5
    }
  }
}
```

| Key | Default | Notes |
| --- | --- | --- |
| `enabled` | `true` | Turn the judge off without removing credentials. |
| `provider` | `typesafe` | Only TypeSafe is supported today. |
| `baseURL` | `https://api.typesafe.ai` | Point at a self-hosted instance or gateway. |
| `model` | `jev-latest` | Model alias sent with every request. |
| `timeoutMs` | `4000` | Hard per-request timeout. |
| `mcp.classifyTools` | `true` | Classify MCP tools for approval gating. |
| `mcp.preloadTools` | `true` | Pre-activate likely MCP tools per turn. |
| `mcp.preloadThreshold` | `0.5` | Minimum probability (0-1) to pre-activate. |

## API

- `GET /v1/config/judge` returns effective settings, credential status
  (`env` / `stored` / `none`), and defaults. The key itself is never returned.
- `PUT /v1/config/judge` accepts any subset of the settings plus an optional
  `apiKey` (empty string removes the stored key). Settings persist to the
  global config; the key persists to the secure auth store.

## Failure behavior

Every judge call returns `{ ok: false, reason }` instead of throwing.
Callers fall back to the current behavior:

| Situation | Classification | Pre-activation |
| --- | --- | --- |
| No credentials / disabled | Annotations only; unannotated tools stay unclassified | Skipped |
| Network error / non-2xx | Unclassified for that batch; retried on next connect | Skipped for that turn |
| Timeout | Same as error | Skipped for that turn |

Debug logs under the `[mcp]` prefix record batch sizes, selections, and failures.

## Using the judge in code

```ts
import { createJudge, judgeChoice, judgeNoul } from '@ottocode/sdk';

const judge = await createJudge({ settings: cfg.judge, projectRoot });
if (judge) {
  const result = await judge.judge({
    state: { cmd: 'rm -rf build' },
    questions: {
      destructive: judgeNoul('Does this command delete data outside a build directory?'),
      scope: judgeChoice('What does it touch?', { workspace: null, system: null }),
    },
  });
  if (result.ok) {
    result.answers.destructive.noul; // 0..1
    result.answers.scope.choice; // 'workspace' | 'system'
  }
}
```

Keep policy (thresholds, escalation) in code and give each question enough
state to answer. See the installed `typesafe-ai` skill under `.agents/skills/`
for prompting guidance.
