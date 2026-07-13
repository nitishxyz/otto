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

## How It Works

The desktop app embeds the compiled ottocode binary and ensures a single shared local daemon is running. Opening a folder reuses that daemon and calls `POST /v1/projects/open`; the returned `projectId` and daemon token are passed to the web UI so API and streaming calls are scoped with `X-Otto-Project-Id`, `X-Otto-Project`, and daemon auth headers.

Desktop compares the registered daemon version with the selected CLI version before reuse. If the daemon is stale or the versions differ, desktop stops the registered daemon only after verifying its daemon id/pid through `/v1/server/info`, clears the registration, and starts a replacement daemon.

CLI selection is conservative: desktop checks the embedded CLI and a local installed CLI (`OTTO_CLI_PATH`, `~/.config/otto/bin/otto`, then `PATH`). If the embedded CLI is newer than the local CLI, desktop prefers the embedded CLI instead of replacing files on disk. Replacing a user-installed CLI from the app bundle is intentionally avoided because install locations can have different ownership, package-manager provenance, quarantine/signature state, and no reliable cross-platform rollback. If the local CLI is the same version or newer, desktop uses the local CLI.

When the CLI detects the desktop app is installed, running `otto` with no arguments opens the desktop app instead of the browser.

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
- Windows: `.trash`
