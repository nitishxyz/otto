# Official Ghostty VT WebAssembly

Otto's web and Tauri desktop clients use the same inline terminal implementation in `@ottocode/web-sdk`. The daemon remains the PTY owner and transports bytes over the authenticated terminal WebSocket; WebAssembly only parses VT state and encodes input, while `ghostty-web`'s MIT-licensed canvas renderer draws the adapted render state.

## Pinned asset

The checked-in `packages/web-sdk/src/assets/ghostty/ghostty-vt.json` is the single source of truth for the upstream repository, release ref, resolved commit, release asset URL, retrieval date, byte size, and SHA-256 digest. The runtime integrity constant and deterministic asset test both consume that metadata.

The current pin is the official `tip` release at upstream commit `9009122953f59d4900143aad587202a70c2136f4`, with SHA-256 `87258cdadb1e7101dd26fbc669fea5482ccba709aa6b261275851edd36d298e8` and size 876,132 bytes. The asset is bundled by Vite and is never fetched from GitHub at runtime. Its low-level ABI is isolated in `packages/web-sdk/src/lib/ghostty-vt.ts`. Struct sizes and field offsets are read from `ghostty_type_json()` rather than duplicated in TypeScript.

## Updating the vendored asset

Prefer a stable Ghostty release tag when one contains `ghostty-vt.wasm`. Use the moving nightly `tip` release only when the newer terminal ABI or fixes are required. In either case, inspect the release first; inspection downloads the official release asset and reports its resolved commit, size, URL, and digest without modifying the working tree:

```bash
bun run ghostty-vt:update --ref <stable-tag-or-tip> --inspect
```

Review the upstream release and ABI changes, then copy the exact digest and commit printed by inspection into the update command:

```bash
bun run ghostty-vt:update --ref <stable-tag-or-tip> \
  --sha256 <reported-sha256> \
  --commit <reported-commit>
```

The updater fetches `ghostty-vt.wasm` from the official `ghostty-org/ghostty` GitHub release, resolves the release tag to an upstream commit, verifies the release size and requested SHA-256, atomically replaces the vendored Wasm, and rewrites the metadata file. It aborts before replacement on a digest, commit, size, release, or asset mismatch. Running it with no options safely verifies the currently recorded ref and digest; because `tip` is mutable, a changed nightly artifact must always be explicitly inspected and accepted.

Before committing an update, run:

```bash
bun test tests/ghostty-vt.test.ts tests/update-ghostty-vt.test.ts
bun run --filter @ottocode/web-sdk typecheck
bun run --filter @ottocode/web-sdk build
bun lint
git diff --check
```

Review both the metadata and binary diff, and include them in the same commit. `GITHUB_TOKEN` may be set for the updater when unauthenticated GitHub API rate limits are insufficient.

## Client architecture

`TerminalViewer` owns WebSocket ticket authorization, reconnects, resize messages, and process-exit handling. `InlineGhosttyTerminal` owns the canvas, official key encoder, fitting, wheel scrolling, and render scheduling. `GhosttyVtTerminal` owns Wasm memory and handles, VT writes, resize/reflow, render-state iteration, styles, colors, cursor state, and graphemes.

Desktop uses the shared official-Wasm `TerminalViewer` by default. If that viewer reports an initialization failure, `DesktopTerminalViewer` replaces it with the existing Rust `NativeTerminalViewer`. Web has no equivalent native backend and displays an explicit initialization error instead.

## Current upstream ABI limitations

The official freestanding module has no imports. Terminal-generated replies (for example DA/DSR) are exposed only through `GHOSTTY_TERMINAL_OPT_WRITE_PTY`, which accepts a native Wasm function pointer. The current browser WebAssembly API cannot install a JavaScript callback into that table, and the official module does not expose a pull-based response queue. These replies therefore cannot yet be forwarded by the official path. The desktop native implementation remains available as the initialization fallback until upstream exposes a browser-callable reply mechanism.

The first migration also does not yet expose OSC 8 link activation or a canvas text-selection bridge. VT parsing, primary/alternate screens, resize/reflow, cursor, SGR colors/styles, Unicode graphemes, keyboard/composition/paste encoding, focus, binary streaming writes, and viewport wheel scrolling use the official module. Accessibility is currently the focusable terminal/input role rather than a full screen-reader transcript.
