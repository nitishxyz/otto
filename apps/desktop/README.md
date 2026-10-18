# otto desktop

Desktop application for otto — wraps the CLI binary and web UI in a native window using Tauri v2.

## Stack

- [Tauri v2](https://tauri.app) (Rust backend)
- React 19, Vite, Tailwind CSS (frontend)
- `@ottocode/web-sdk` for UI components

## Development

```bash
# From monorepo root
bun run dev:desktop

# Or build for release
bun run build:desktop
```

Requires Rust toolchain and Tauri CLI prerequisites. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

`libghostty-vt-sys` 0.2.x compiles Ghostty from source with Zig, and the pinned Ghostty commit requires Zig 0.15.x (0.15.2 or newer patch). Zig 0.16+ is rejected. The official Zig 0.15.2 tarball cannot build on macOS SDKs from Xcode/Command Line Tools 26.4 onward, including macOS 27. Those SDK `.tbd` stubs list only `arm64e` targets for `libSystem`, so linking the Zig build runner fails with undefined `_free`, `_getenv`, and similar symbols. The macOS 27 `math.h` also breaks libc++ with an undefined `INFINITY`. Homebrew's keg-only `zig@0.15` carries both upstream fixes, ziglang/zig#31673 and llvm/llvm-project#164348. On macOS, put it first on `PATH` for desktop builds:

```bash
brew install zig@0.15
export PATH="$(brew --prefix zig@0.15)/bin:$PATH"
```

`DOCS_RS=1 cargo check` skips the native Ghostty and Objective-C builds, and Cargo does not rerun those build scripts when the variable is later removed. Use a separate `CARGO_TARGET_DIR` for such checks, or `cargo clean` before a real build.

## How It Works

The desktop app embeds the compiled ottocode binary and ensures a single shared local daemon is running. Opening a folder reuses that daemon and calls `POST /v1/projects/open`; the returned `projectId` and daemon token are passed to the web UI so API and streaming calls are scoped with `X-Otto-Project-Id`, `X-Otto-Project`, and daemon auth headers.

Desktop compares the registered daemon version with the selected CLI version before reuse. If the daemon is stale or the versions differ, desktop stops the registered daemon only after verifying its daemon id/pid through `/v1/server/info`, clears the registration, and starts a replacement daemon.

CLI selection is conservative: desktop checks the embedded CLI and a local installed CLI (`OTTO_CLI_PATH`, `~/.config/otto/bin/otto`, then `PATH`). If the embedded CLI is newer than the local CLI, desktop prefers the embedded CLI instead of replacing files on disk. Replacing a user-installed CLI from the app bundle is intentionally avoided because install locations can have different ownership, package-manager provenance, quarantine/signature state, and no reliable cross-platform rollback. If the local CLI is the same version or newer, desktop uses the local CLI.

When the CLI detects the desktop app is installed, running `otto` with no arguments opens the desktop app instead of the browser.

### Notification activation (macOS)

Session notification clicks target one window, scoped by server URL, project ID, and workspace path. The window currently showing that session wins; other windows ignore the activation before focusing or navigating. Notification deduplication uses the same workspace scope so identical IDs on different remote servers remain independent.

If the original window closes or changes projects, another window in the same workspace is reused. If that workspace is no longer open, the normal new-window builder restores the notification's project and session in a fresh window, preserving machine bootstrap when available. Unrelated windows remain unchanged.

Listeners are installed before window availability is published, and registration/cleanup are serialized across workspace changes. Activation rechecks its workspace generation after asynchronous window operations and query refreshes. Machine fallback snapshots retain only routing metadata, not owner-session credentials; a fresh owner session is acquired through the local daemon's authorized-machine API before opening the captured project.

### Native terminal

The desktop terminal uses the cross-platform `libghostty-vt` Rust bindings for VT parsing, render state, keyboard encoding, scrollback, and terminal-generated responses. A parented, non-focusable `wgpu` surface renders with Metal on macOS, Vulkan/GLES on Linux, and DirectX 12 on Windows. The web app continues to use `ghostty-web`, and Desktop retains a Canvas fallback when no compatible GPU adapter is available.

Four JetBrains Mono Nerd Font variants are bundled for complete terminal and private-use glyph coverage. Native Desktop terminals always use the bundled monospace family, matching `ghostty-web` and preventing remote UI-font preferences or unavailable system fonts from breaking the PTY grid. Terminal metrics are measured from that font so the PTY grid and renderer remain aligned.

Native terminal colors, including the ANSI palette, cursor, and selection, are derived from the active Otto application theme and update without reconnecting the PTY. Drag selection supports the platform clipboard conventions (`Cmd+C`/`Cmd+V` on macOS, `Ctrl+Shift+C`/`Ctrl+Shift+V` and Insert variants elsewhere). macOS shell editing also maps Option+Arrow to word navigation, Option+Backspace to word deletion, Cmd+Arrow to line boundaries, and Cmd+Backspace to line deletion.

Terminal processes remain owned by the otto daemon. Desktop feeds the daemon's existing ticket-authenticated WebSocket stream into the native parser, so local terminals, remote machines, managed tunnels, and project-share tunnels use the same protocol and authorization path. PTYs advertise the portable `xterm-256color` terminfo entry and `COLORTERM=truecolor`; Otto does not advertise Ghostty-specific terminfo unless that database is explicitly bundled on the daemon host. If the native Tauri command is unavailable, the desktop viewer falls back to `ghostty-web`.

## Changing the App Icon

### Main App Icon

Canonical icon sources live under `assets/brand/`. Update the appropriate SVG there, then regenerate repository-managed raster and web assets from the monorepo root:

```bash
bun run brand:generate
```

To troubleshoot Tauri output generation for an individual app, run:

```bash
bun run --cwd apps/desktop icon
bun run --cwd apps/launcher icon
bun run --cwd apps/canvas icon
```

Do not hand-edit generated files under `src-tauri/icons/`, and do not use `src-tauri/icons/icon.png` as generation input. It is generated from the canonical SVG and reusing it would cause cumulative quality loss. Commit canonical SVG changes and generated icon sets together according to repository convention.

### Tray Icon (macOS Template Mode)

For theme-aware tray icons on macOS:

1. Create `tray-icon.png` (256x256px recommended)
   - Use **grayscale with transparency** — macOS handles tinting
   - Dark areas become the menu bar color
   - Transparent areas stay transparent

2. The tray icon is already configured with `iconAsTemplate: true` in `tauri.conf.json`

3. macOS will automatically invert the icon for light/dark menu bar themes

### Programmatic Icon Switching

To dynamically change the tray icon based on theme or state:

```typescript
import { TrayIcon } from "@tauri-apps/api/tray";

// Get tray instance and update icon
const tray = await TrayIcon.getById("main");
await tray?.setIcon("icons/tray-dark.png"); // or tray-light.png
await tray?.setIconAsTemplate(true); // Enable template mode
```

## Build Targets

- macOS: `.dmg`, `.app`
- Linux: `.AppImage`
- Windows: `.msi`, `.exe`
