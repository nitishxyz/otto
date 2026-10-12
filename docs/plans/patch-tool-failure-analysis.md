# apply_patch Tool — Failure Analysis

> **Superseded (October 2026):** the coverage gaps listed here now have regression tests in `tests/patch-apply.test.ts`. Remaining patch defects (partial multi-file commits, semantic partial-match fallbacks) are tracked in [harness-reliability-roadmap.md](harness-reliability-roadmap.md).

## Sessions Analyzed

| # | Session | Model | Date |
|---|---------|-------|------|
| 1 | GLM 4.7 extensive patch testing | Gemini | 2026-02-08 |
| 2 | Kimi K2.5 extensive patch testing | Kimi K2.5 | 2026-02-08 |

---

## Session 1: GLM 4.7 (Gemini)

**Stats**: ~20 invocations, 7 failures

### Failure 1: Context lines don't match file content (hallucinated context)

**File**: `infra/domains.ts`

The agent typed `${$app}.` in context, but the file contained `${$app.stage}.`. The agent reconstructed the line from memory instead of copying verbatim.

```
# Agent wrote:
  const SUB = $app.stage === 'prod' ? '' : `${$app}.`;

# File actually contains:
  const SUB = $app.stage === 'prod' ? '' : `${$app.stage}.`;
```

**Category**: Hallucinated context (agent error)

### Failure 2: `---` horizontal rules parsed as diff markers

**File**: `docs/architecture.md`
**Occurrences**: 5 separate failures

Markdown `---` horizontal rules collide with the unified diff `---` (old file) marker. The parser strips or misinterprets them — error messages show `--` (2 dashes) instead of `---` (3 dashes).

**What finally worked**: Including extensive context (the full block between two `---` rules) so the tool could match without relying on `---` as a boundary.

**Category**: Format collision — Markdown `---` vs unified diff `---` (tool bug)

### Failure 3: Stale hunk with `allowRejects: true` (intentional test)

Intentional test — tool correctly rejected the stale hunk.

**Category**: Working as designed

### Session 1 Summary

| Category | Count | Severity |
|----------|-------|----------|
| Hallucinated context (agent error) | 1 | Medium |
| `---` parsed as diff marker (tool bug) | 5 | **High** |
| Stale hunk rejection (intentional) | 1 | N/A |

---

## Session 2: Kimi K2.5

**Stats**: ~30 invocations, 7 failures / incorrect results

### Failure 4: YAML context mismatch — `ubuntu-latest` vs `ubuntu-22.04`

**File**: `.github/workflows/release.yml` (build-desktop matrix)

The agent used context referencing `ubuntu-latest` but the file had `ubuntu-22.04`. The tool correctly rejected the patch.

```
*** Update File: .github/workflows/release.yml
@@ matrix section - add windows
          - platform: macos-latest
            target: x86_64-apple-darwin
            name: macOS-x64
          - platform: ubuntu-latest          ← WRONG: file has ubuntu-22.04
            target: x86_64-unknown-linux-gnu
            name: Linux-x64
+          - platform: windows-latest
```

**Error**: `Failed to apply patch hunk ... Expected to find: ... - platform: ubuntu-latest`

**Category**: Stale/wrong context (agent error). The agent likely mixed up the two matrix blocks in release.yml — `build-cli` uses `ubuntu-latest` while `build-desktop` uses `ubuntu-22.04`.

### Failure 5: YAML +1 extra space on inserted lines

**File**: `.github/workflows/release.yml` (build-desktop matrix, 2nd attempt)

After fixing the context to use `ubuntu-22.04`, the patch succeeded but **added 1 extra leading space** to the inserted lines.

```yaml
# File indentation (10 spaces):
          - platform: ubuntu-22.04

# Tool inserted (11 spaces):
           - platform: windows-latest     ← 11 spaces, should be 10
```

The agent provided context with correct 10-space indentation. The tool's fuzzy indentation correction overcompensated by +1 space.

**Category**: Indentation correction overcorrection (tool bug). This is the same +1 space regression documented in the test suite at `tests/patch-apply.test.ts`.

**Workaround**: The `*** Replace in:` format applied the same change with **perfect indentation** — no +1 space. Replace format bypasses the hunk-based indentation correction logic entirely.

### Failure 6: Markdown bullet duplication

**File**: `apps/desktop/README.md`

The first patch attempt on the README used a remove-and-add pattern for bullet items:

```
-- [Tauri v2](https://tauri.app) (Rust backend)
-- React 19, Vite, Tailwind CSS (frontend)
+- [Tauri v2](https://tauri.app) (Rust backend + IPC)
+- React 19, Vite, Tailwind CSS (frontend UI)
 - `@ottocode/web-sdk` for UI components
+- Native platform APIs via Tauri plugins
```

The result was **duplicated lines** — the originals were kept AND the new versions were inserted. The `- `@ottocode/web-sdk`` context line was consumed, and `- Native platform APIs` ended up inside the `## Development` section.

**Post-patch file content**:
```markdown
- [Tauri v2](https://tauri.app) (Rust backend)
- React 19, Vite, Tailwind CSS (frontend)
- [Tauri v2](https://tauri.app) (Rust backend + IPC)     ← duplicate
- React 19, Vite, Tailwind CSS (frontend UI)              ← duplicate
## Development
- Native platform APIs via Tauri plugins                   ← wrong location
```

**Root cause**: The remove lines (`-- [Tauri v2]...`) start with `- -` which the parser likely confuses with a Markdown bullet removal. The `-` prefix of the patch remove instruction collides with the `-` that starts the Markdown bullet content.

**Category**: Format collision — Markdown bullets starting with `- ` collide with patch remove prefix `- ` (tool bug). Same class of issue as the `---` horizontal rule collision from Session 1.

### Failure 7: TypeScript tab/space indentation mismatch on added line

**File**: `apps/cli/src/ask/capture.ts`

The file uses **tab indentation**. The agent's patch replaced `'ripgrep'` with `'glob'` (correct, tabs preserved), but also added `'websearch'` with **space indentation**:

```typescript
const READ_ONLY_TOOLS = new Set([
	'read',          // tab
	'ls',            // tab
	'tree',          // tab
	'glob',          // tab (correctly converted from agent's space)
	'git_diff',      // tab
	'git_status',    // tab
 'websearch',     // SPACE ← wrong, should be tab
]);
```

The agent wrote `+ 'websearch',` with a leading space in the patch. The tool converted the replacement line `'glob'` to use tabs (matching the file) but did **not** convert the pure addition line `'websearch'`.

**Category**: Inconsistent indentation conversion on additions (tool bug). The tool correctly converts replacement lines (lines that have a corresponding removal) but fails to convert pure addition lines that don't have a paired removal to infer indentation from.

### Failure 8: Intentional bad context — fuzzy match false positive

**File**: `test-patch-files/error-test.ts`

The agent sent a patch with completely wrong context (`function wrongName()`) expecting a hard rejection. Instead, the fuzzy matcher found a partial match and **applied the change anyway**, producing a corrupted file.

**Category**: Fuzzy matching too aggressive (tool behavior). The tool should have rejected this — the function name was completely different.

### Failure 9: `allowRejects` mixed-hunk corruption

**File**: `test-patch-files/error-test.ts`

With `allowRejects: true`, the agent sent one valid hunk and one invalid hunk. The valid hunk changed `const b = 2` to `const b = 200` correctly. But the invalid hunk's result line (`also invalid`) ended up in the file even though the context didn't match, producing:

```typescript
function test() {
  const a = 1;
  const b = 200;
  const c = 3;
also invalid        ← corrupted, should not be here
}
```

**Category**: `allowRejects` hunk boundary confusion (tool bug). When the second hunk was supposed to be rejected, part of its content leaked into the file.

### Failure 10: YAML duplicate insertions (already-applied detection)

**File**: `test-patch-files/deep.yml`

Two sequential patches both tried to insert `item3` entries. The already-applied detection did not prevent the second insertion, resulting in duplicate `item3` entries.

**Category**: Already-applied detection gap (tool limitation). The tool checks for exact position matches but not content-level deduplication.

### Session 2 Summary

| # | Category | Type | Severity |
|---|----------|------|----------|
| 4 | Stale context (`ubuntu-latest` vs `ubuntu-22.04`) | Agent error | Low — correct rejection |
| 5 | YAML +1 extra space on inserted lines | **Tool bug** | **High** |
| 6 | Markdown bullet duplication (`- ` collision) | **Tool bug** | **High** |
| 7 | Tab/space mismatch on pure addition lines | **Tool bug** | **Medium** |
| 8 | Fuzzy match false positive on wrong function name | Tool behavior | Medium |
| 9 | `allowRejects` hunk content leakage | **Tool bug** | **Medium** |
| 10 | Already-applied detection miss (duplicates) | Tool limitation | Low |

---

## Cross-Session Analysis

### Tool Bugs (Confirmed)

| Bug | Sessions | Files Affected | Workaround |
|-----|----------|---------------|------------|
| `---` parsed as diff marker | 1 | Markdown with horizontal rules | Use `*** Replace in:` or include extensive surrounding context |
| +1 extra space on YAML insertions | 2 | Deeply nested YAML | Use `*** Replace in:` format |
| Markdown `- ` bullet collision with remove prefix | 2 | Markdown with bullet lists | Use `*** Replace in:` format |
| Pure addition lines not indentation-corrected | 2 | Tab-indented files | Ensure additions have matching indentation, or pair with a no-op removal |
| `allowRejects` content leakage | 2 | Any file with mixed valid/invalid hunks | Avoid mixed hunks; split into separate patches |

### Agent Errors (Both Models)

| Error | Sessions | Prevention |
|-------|----------|------------|
| Hallucinated context (wrong variable) | 1 | Read file immediately before patching; copy verbatim |
| Stale context (wrong value in similar block) | 2 | Verify exact line content from fresh read output |
| Wrong indentation style in additions | 2 | Check file's indentation convention before writing patch |

### Key Recommendations

1. **Use `*** Replace in:` for YAML and Markdown** — it bypasses hunk-based indentation correction and avoids the `- ` / `---` collision bugs entirely
2. **Read files immediately before patching** — both models failed when relying on earlier reads or memory
3. **For tab-indented files**, ensure ALL lines (including pure additions) use tabs — the tool only converts replacement lines, not pure additions
4. **Avoid `allowRejects` for critical changes** — hunk boundary confusion can corrupt files
5. **The +1 space YAML bug** is the most impactful issue — it silently corrupts YAML indentation, which breaks structure

### Test Coverage Gaps

The existing test suite (`tests/patch-apply.test.ts`, 46 tests) covers many indentation scenarios but does NOT cover:
- Real-world deeply nested YAML with the `*** Update File` format (the +1 bug)
- Markdown bullets with `- ` prefix in remove lines
- `allowRejects` with content leakage across hunk boundaries
- Already-applied detection with content at different positions
