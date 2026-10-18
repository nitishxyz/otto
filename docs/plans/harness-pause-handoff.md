# Harness cleanup pause handoff

Implementation paused at the user's request after the desktop notification agent returned. No further implementation or review pass was started before committing.

## October 13 continuation result

The existing harness/cross-layer refactor was resumed, not the proposed Rust rewrite. Pre-existing notification fixes and this handoff's native-build findings were preserved. No commit, live daemon restart, user-data cleanup, credentialed provider request, or GUI launch was performed.

- Reconciled baseline agents credentials/Kimi reasoning tests and additional host-dependent judge, stale CLI metadata, TUI provider/import-guard and canonical SSE fixtures. Production auth/reasoning/event validation contracts were retained.
- Generated ignored CLI web assets via `bun run scripts/build-web.ts --verbose`; this is required before CLI tests/typecheck on a fresh checkout.
- Final `bun run test` completed: **388 repository files, 2,691 pass, 0 fail, 3 skip** in 46.29 seconds; **26 desktop files, 138 pass, 0 fail** in 0.135 seconds. Total: **414 files, 2,829 pass, 0 fail, 3 skip**. Both groups run shared-process, not file-isolated.
- Final `bun run scripts/check-test-suite.ts` independently completed the same **414 files, 2,829 pass, 0 fail, 3 skip**, with no file deadline exceeded. Temporary logs and `results.json`: `/var/folders/5d/c_yldvrx69d3k9_gxxw5j24c0000gn/T/otto-suite-fXEVyt` (machine-local, not a durable artifact).
- Focused agents/reasoning/judge/SSE/daemon-service combined rerun: **67 pass, 0 fail**. Desktop package-local combined rerun: **138 pass, 0 fail**. `bun lint`, full `bun typecheck`, clean API regeneration and `git diff --check` passed.
- The earlier 300-second timeout (1,567 observed passes, 7 failures, 2 skips) was diagnosed and fixed, not accepted via isolation. The registry hang minimizes to `prompt-audit` plus `harness-projects-registry-lock`: concurrent audit snapshots restored `Date` out of order, leaving January 1 frozen globally. Audit clock ownership is now serialized, with concurrent-restoration and invalid-time regression assertions. The web failure minimizes to OpenTUI secure-input rendering, image-streaming regression and the event multiplexer: OpenTUI leaves a `{ requestAnimationFrame }` window shim, poisoning later config initialization which requires `location`. Renderer tests now restore the window descriptor; web fixtures restore context and release streams on failed assertions. Sidebar tests inject storage instead of installing a module-load window shim. All seven original failing tests pass together: **16 pass, 0 fail across 7 files** (including the new audit test).
- The old default `bun test tests packages/*/tests ...` also treated bare names as filters, unintentionally discovering desktop tests from root cwd. `scripts/test.ts` now supplies explicit file paths and runs desktop with package-local cwd, preserving shared-process regression coverage and imposing a 180-second deadline per group. A further ambient-credential dependency in new-session agent coverage was fixed with an explicit fake API key and restoration; no auth checks were weakened.
- Fresh native `cargo test`: **42 pass, 0 fail**. `bun run tauri build --no-bundle` from `apps/desktop/src-tauri` succeeded in release mode, producing `target/release/otto-desktop` (Mach-O arm64). Both commands used `DEVELOPER_DIR=/Library/Developer/CommandLineTools` and Homebrew `zig@0.15` first in PATH. This is a native optimized binary build, not bundle/sign/notarization or GUI acceptance. No signing credentials were requested or used.
- The roadmap now maps the recorded critical categories to current owners and named tests. The original externally numbered P0 audit is not available in the checked-in plans inspected here, so exhaustive one-to-one provenance remains unproven. Instance-owned `createApp()` runtimes remain explicitly deferred by the existing roadmap, not an unfinished required extraction.

Remaining external acceptance: notification clicks across multiple windows/projects/servers, a closed originating window, and a project switch during activation; app launch and bundle/sign/notarization with the release owner's credentials; CI SDK migration to patched Zig 0.15 when macOS runner SDKs reach 26.4+. The current `macos-14` official Zig pin was not changed without a failing runner reproduction. Single-host/PID-namespace recovery and unknown-outcome semantics are unchanged. Future boards, durable queued execution, remote/Docker/VM jobs and Rust/GPUI remain separate designs.

## Included work

- Harness lifecycle, persistence, compaction, project scoping, tool policy and durable subagent delivery hardening.
- Anthropic OAuth refresh/storage fixes and live image preview recovery.
- Database-to-SDK dependency removal, canonical provider dispatch and shared shell execution lifecycle.
- Restart-durable tool intent/outcome journals with owner-aware recovery; external effects are never automatically rerun. Unrecorded outcomes remain unknown.
- macOS isolated PTY transport plus fd-3 startup gate addressing the upstream fast-exit/watch-registration race. Bun itself has not been patched.
- Desktop notification activation targets one window, with asynchronous workspace-generation guards, listener-before-registration ordering and immutable credential-free machine routing snapshots.

## Verification at pause

Earlier combined cleanup review: lint and workspace typechecks passed; 401 focused tests passed. A 100-file broader subset had 813 passes and two failures independently reproduced on archived HEAD (agents credential fixture and Kimi reasoning fixture). This was not a complete repository test run.

Later PTY/desktop review: 34 mixed helper/shell/plugin tests passed, SDK and desktop TypeScript checks passed. Compiled PTY smoke passed during helper implementation. Upstream Bun issue remains external; workaround is not a claim of an upstream repair.

Latest desktop lifecycle fixes: 14 routing/lifecycle/restoration tests passed; desktop TypeScript, scoped Biome, Rust formatting and diff checks passed. An extracted-source Rust harness passed 9 tests, but excludes Tauri handlers and window creation. These latest lifecycle fixes have not received another independent review, per the requested pause.

## Resumed review (fresh macOS 27.0.1 machine)

Independent review of the notification lifecycle covered cancellation across awaits, immutable remote restoration and registration cleanup ordering.

- Registration ordering holds: the listener is installed before publication, the shared per-window queue serializes old-generation `null` cleanup before the next generation registers, and disposal before publication never publishes.
- Remote restoration holds: Rust snapshots the window's machine at registration time, strips owner-session fields, rejects JS-supplied `machine` (`skip_deserializing`), and restoration reauthorizes and requires a matching machine/device plus project ID and path. Machine switching only happens from the picker, after the sessions layout has unmounted and unregistered.
- Fixed (low): concurrent activations in one window let the older click win. The older activation's navigation changed the generation and cancelled the newer one. Activations now carry a per-window sequence token, so older in-flight activations yield (`apps/desktop/src/lib/notification-lifecycle.ts`, with a regression test).
- Fixed (low): when fallback window creation failed after `before_build`, initial-notification and machine-window entries leaked. They are now rolled back (`apps/desktop/src-tauri/src/commands/notification.rs`), mirroring `open_machine_window`.
- Accepted (low, not changed): an owner-session renewal creates a new `project` object, which cancels any activation that is in flight at that moment. The initial notification context is also kept until the window is destroyed (for StrictMode idempotence), so a manual webview reload reopens that session.

Verification: 138 desktop tests passed (`bun test tests` in `apps/desktop`), including 15 notification tests. Desktop `tsc --noEmit` passed after `bun install --frozen-lockfile` and `bun run build:packages`. `bun lint` exited 0. `DOCS_RS=1 cargo check --all-targets` type-checked the full Tauri crate, including handlers and tests, with no warnings. This used the checked-in ghostty bindings, so it is neither a link nor a native build. `cargo fmt --check` passes for `notification.rs`, but rustfmt 1.99 reports pre-existing diffs in `lib.rs` and `startup_target.rs`, which were left untouched.

### Native Zig/Ghostty build on macOS 27

Root cause: `libghostty-vt-sys` 0.2.1 (and 0.2.2, which pins the same Ghostty commit `a887df42`) runs `zig build`. Ghostty's `requireZig` accepts only Zig 0.15.x at 0.15.2 or later, so Zig 0.16/0.17 are not options. The official Zig 0.15.2 tarball has two problems with SDKs from Xcode/Command Line Tools 26.4 onward:

- The SDK `libSystem` `.tbd` stubs list only `arm64e-macos`, and on macOS 27 also `arm64e.x1-macos`. They no longer list `arm64-macos`. Zig's Mach-O linker therefore resolves no libc symbols for the native build runner. This is ziglang/zig#31658, fixed in 0.16 by #31673 and never released for 0.15.
- The macOS 27 `math.h` breaks libc++ with an undefined `INFINITY` (llvm/llvm-project#164348). That is the error reported before the pause.

Explicit `-target aarch64-macos.N` probes only succeeded because they use Zig's bundled `libSystem.tbd` instead of the SDK. They cannot be applied to the build runner, so they are not a fix.

Fix: Homebrew's keg-only `zig@0.15` (0.15.2 bottle, rebuild 1) carries both patches. It was installed with `HOMEBREW_NO_AUTO_UPDATE=1 brew install zig@0.15`, which also pulled keg-only `llvm@20` and `lld@20`. The default PATH, `xcode-select` and the Xcode license were not changed. The prerequisite is documented in `apps/desktop/README.md`. No repository build configuration, dependency source or CI file was changed. Desktop CI still pins the official 0.15.2 on `macos-14`, which works with that runner's older SDK, but it will hit the same failure once runner images ship an Xcode 26.4+ SDK.

Verified with `export DEVELOPER_DIR=/Library/Developer/CommandLineTools PATH=/opt/homebrew/opt/zig@0.15/bin:$PATH`:

- `cargo clean -p libghostty-vt-sys && cargo build -p libghostty-vt-sys` in `src-tauri` built Ghostty natively in 1m02s and produced `libghostty-vt.a` and the dylib.
- `cargo clean && cargo test` passed 42 tests, including the `native_terminal` tests that use the linked libghostty-vt.
- `bun run tauri build --debug --no-bundle` in `apps/desktop` built the frontend and the debug app binary `target/debug/otto-desktop` (arm64, SDK 27.0, minos 11.0, libghostty-vt statically linked).
- A release build, bundling/signing and running the app were not done.

Pitfall: the earlier `DOCS_RS=1 cargo check` left empty build-script outputs in the shared target dir. Ghostty and `mac-notification-sys` were skipped, which caused a fake "success" and then `ld: library 'notify' not found`. A full `cargo clean` was needed.

Xcode's license is still unaccepted, so `git` works only with the Command Line Tools `DEVELOPER_DIR`.

## Resume here

1. Done: the independent lifecycle review is complete (see above).
2. Done for local debug and release binary builds: native Ghostty builds, 42 Rust tests and both Tauri app builds pass with Homebrew `zig@0.15`. Remaining: bundle/sign/notarization and moving desktop CI to a patched Zig 0.15 once macOS runner SDKs reach 26.4+. Zig 0.16 becomes possible when `libghostty-vt-sys` pins a Ghostty that supports it.
3. Manually test notification clicks with multiple desktop windows, different projects/servers, a closed original window and a project switch during activation.
4. Default shared-process and independent split acceptance are complete; the seven interference failures are fixed as recorded above. Retain documented single-host/PID-namespace recovery assumptions and unknown-outcome semantics.
5. Future task-board and remote/Docker/VM subagent work remains unimplemented and requires a separate design discussion.

No live daemon restart was performed. Existing daemon processes should be restarted when adopting the changed registry locking mechanism. The untracked `.otto/agents/testagent/agent.md` old fixture is intentionally excluded from the commit and left untouched.

See [Harness reliability roadmap](harness-reliability-roadmap.md) for architecture, evidence and operational limits.
