# Harness cleanup pause handoff

Implementation paused at the user's request after the desktop notification agent returned. No further implementation or review pass was started before committing.

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

## Resume here

1. Independently review the latest desktop notification lifecycle fixes, especially cancellation across awaits, immutable remote machine restoration and registration cleanup ordering.
2. Complete native Tauri compilation and notification integration tests. Current blocker: libghostty-vt-sys 0.2.1 building via Zig 0.15.2 against macOS 27 SDK fails in libc++ with an undefined INFINITY identifier. Do not treat the extracted Rust harness as a full native build.
3. Manually test notification clicks with multiple desktop windows, different projects/servers, a closed original window and a project switch during activation.
4. Run final combined checks as appropriate; retain documented single-host/PID-namespace recovery assumptions and unknown-outcome semantics.
5. Future task-board and remote/Docker/VM subagent work remains unimplemented and requires a separate design discussion.

No live daemon restart was performed. Existing daemon processes should be restarted when adopting the changed registry locking mechanism. The untracked `.otto/agents/testagent/agent.md` old fixture is intentionally excluded from the commit and left untouched.

See [Harness reliability roadmap](harness-reliability-roadmap.md) for architecture, evidence and operational limits.
