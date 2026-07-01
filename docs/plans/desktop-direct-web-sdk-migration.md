# Desktop Direct Web SDK Migration Plan

## Goal

Turn the desktop app into a first-class app that renders the `@ottocode/web-sdk` workspace directly instead of loading the served web app inside an iframe/webview boundary.

The desktop app should still use the existing API/server stack. The migration removes the extra embedded web UI server layer from the desktop workspace path.

## Current Architecture

```txt
Desktop Tauri app
  -> starts `otto serve`
      -> API server on port N
      -> embedded web UI server on port N+1
  -> desktop renders iframe to http://localhost:N+1
      -> web app talks to API at http://localhost:N
```

Key files:

- `apps/desktop/src/components/Workspace.tsx`
  - Starts the project server through `useServer()`.
  - Builds `iframeSrc` from `server.url`.
  - Renders the workspace in an `<iframe>`.
  - Bridges native behavior with `postMessage`.
- `apps/desktop/src-tauri/src/commands/server.rs`
  - Local projects run `otto serve --port <port> --no-open`.
  - Remote projects run `otto web --url <remoteApi> --port <port> --no-open`.
- `apps/web/src/components/sessions/SessionsLayout.tsx`
  - Composes the main workspace using `@ottocode/web-sdk` components and hooks.
- `packages/web-sdk`
  - Already contains most UI components, hooks, stores, and API-client wiring needed by desktop.

## Target Architecture

Local project:

```txt
Desktop Tauri app
  -> starts API server on port N
  -> configures @ottocode/api / @ottocode/web-sdk with http://localhost:N
  -> renders workspace directly with @ottocode/web-sdk components
```

Remote project:

```txt
Desktop Tauri app
  -> does not start local web UI server
  -> configures SDK API base URL to project.remoteUrl
  -> renders same direct workspace
```

Long-term local target:

```txt
Desktop Tauri app
  -> starts API-only `otto serve`
  -> no embedded web UI server
```

## Migration Strategy

Use small, verifiable steps:

1. Render SDK workspace directly in desktop while keeping the current server process unchanged.
2. Add desktop/native platform adapters for behaviors currently handled through iframe `postMessage`.
3. Make remote workspaces direct as well.
4. Add API-only server mode.
5. Remove obsolete iframe/web-server code from desktop.

## Phase 1: Direct Workspace Prototype

### Objective

Render the main workspace directly inside `apps/desktop` for local projects, without the iframe.

Keep `otto serve` unchanged initially, even though it also starts an unused web UI server. This reduces backend risk while proving the UI migration.

### Add desktop workspace components

Create:

```txt
apps/desktop/src/components/workspace/DesktopWorkspaceApp.tsx
apps/desktop/src/components/workspace/DesktopSessionsLayout.tsx
apps/desktop/src/components/workspace/DesktopAppLayout.tsx
apps/desktop/src/components/workspace/DesktopWorkspaceProvider.tsx
apps/desktop/src/lib/sdk-client.ts
```

The desktop components can initially adapt/copy the shell composition from:

```txt
apps/web/src/components/sessions/SessionsLayout.tsx
apps/web/src/components/layout/AppLayout.tsx
apps/web/src/components/layout/Sidebar.tsx
apps/web/src/App.tsx
```

Use `@ottocode/web-sdk` primitives directly:

- `SessionListContainer`
- `MessageThreadContainer`
- `ChatInputContainer`
- `NewSessionLanding`
- `TerminalsPanel`
- `GitSidebar`
- `SessionFilesSidebar`
- `ResearchSidebar`
- `SettingsSidebar`
- `TunnelSidebar`
- `FileBrowserSidebar`
- `MCPSidebar`
- `SkillsSidebar`
- `GitCommitModal`
- `ConfirmationDialog`
- `QuickFilePicker`
- `Toaster`

### Avoid router dependency initially

The web app uses TanStack Router. Desktop can start simpler with local React state:

```ts
const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
```

Then direct navigation is just:

```ts
setActiveSessionId(sessionId);
```

This avoids bringing URL routing into desktop during the first pass.

### Configure SDK API client

Create `apps/desktop/src/lib/sdk-client.ts`:

```ts
import { configureApiClient } from '@ottocode/web-sdk/lib';

interface OttoWindow extends Window {
	OTTO_SERVER_URL?: string;
}

export function configureDesktopSdk(apiUrl: string) {
	(window as OttoWindow).OTTO_SERVER_URL = apiUrl;
	configureApiClient();
}
```

The SDK already checks `window.OTTO_SERVER_URL` in:

- `packages/web-sdk/src/lib/config.ts`
- `packages/web-sdk/src/lib/api-client/utils.ts`

Call this before mounting SDK query/hooks.

### Query provider

Desktop direct workspace needs its own `QueryClientProvider`, similar to `apps/web/src/App.tsx`.

Important: create a fresh `QueryClient` per workspace/API URL so switching projects does not leak cache.

Suggested shape:

```tsx
<DesktopWorkspaceProvider key={apiUrl} apiUrl={apiUrl}>
	<DesktopSessionsLayout />
	<OnboardingModal />
	<OttoRouterTopupModal />
</DesktopWorkspaceProvider>
```

### Update `Workspace.tsx`

Replace the iframe body with direct rendering.

Current body:

```tsx
{server && iframeSrc && <iframe ... />}
```

Target first pass:

```tsx
{server && (
	<DesktopWorkspaceApp
		key={`local:${server.port}:${project.path}`}
		apiUrl={`http://localhost:${server.port}`}
		project={project}
		theme={theme}
		onToggleTheme={toggleTheme}
	/>
)}
```

Keep the desktop title bar, back button, updater, theme toggle, and project chrome in `Workspace.tsx`.

### Verification

Run:

```bash
bun run --cwd apps/desktop build
bun lint
```

Manual test:

```bash
bun run --cwd apps/desktop tauri dev
```

Check:

- open local project
- sessions load
- create session
- select session
- send message
- streaming response works
- git sidebar loads
- terminal panel loads
- settings panel opens

## Phase 2: Native Platform Adapters

### Objective

Replace iframe `postMessage` bridges with direct Tauri/native behavior.

Current iframe bridge messages in `Workspace.tsx`:

- `otto-open-url`
- `otto-notification`
- `otto-font-family-changed`
- `otto-list-system-fonts`
- `otto-set-theme`
- `otto-navigate-session`

Direct desktop should not need parent/iframe messaging.

### Add SDK adapter support

Prefer adding small global adapter hooks first, then refactor to a formal SDK platform adapter later if needed.

Potential global adapter interface:

```ts
interface OttoPlatformWindow extends Window {
	OTTO_OPEN_URL?: (url: string) => void | Promise<void>;
	OTTO_SHOW_NOTIFICATION?: (notification: unknown) => void | Promise<void>;
	OTTO_LIST_SYSTEM_FONTS?: () => Promise<string[]>;
	OTTO_SET_DESKTOP_FONT?: (fontFamily: string) => void | Promise<void>;
	OTTO_OPEN_SESSION?: (sessionId: string) => void | Promise<void>;
}
```

### External URLs

Update `packages/web-sdk/src/lib/open-url.ts` to prefer `window.OTTO_OPEN_URL`:

```ts
export function openUrl(url: string) {
	const customOpenUrl = (window as OttoPlatformWindow).OTTO_OPEN_URL;
	if (customOpenUrl) {
		void customOpenUrl(url);
		return;
	}

	if (window.self !== window.top) {
		window.parent.postMessage({ type: 'otto-open-url', url }, '*');
	} else {
		window.open(url, '_blank', 'noopener,noreferrer');
	}
}
```

Desktop registers:

```ts
window.OTTO_OPEN_URL = (url) => openUrl(url);
```

using `openUrl` from `@tauri-apps/plugin-opener`.

### Notifications

Update `packages/web-sdk/src/hooks/useClientEvents.ts` so system notification delivery prefers `window.OTTO_SHOW_NOTIFICATION` before browser `Notification`.

Desktop registers:

```ts
window.OTTO_SHOW_NOTIFICATION = (notification) => showNativeNotification({
	type: 'otto-notification',
	notification,
});
```

Notification click should directly set the active session instead of posting to iframe.

### Font listing

Update `SettingsSidebar` to prefer:

```ts
window.OTTO_LIST_SYSTEM_FONTS?.()
```

Fallback remains current `postMessage` behavior for iframe/browser compatibility.

Desktop registers:

```ts
window.OTTO_LIST_SYSTEM_FONTS = () => tauriBridge.listSystemFonts();
```

### Font family changes

Direct desktop can update CSS/localStorage directly:

```ts
window.OTTO_SET_DESKTOP_FONT = (fontFamily) => {
	document.documentElement.style.setProperty(
		'--otto-font-family',
		`"${fontFamily.replace(/"/g, '\\"')}", "IBM Plex Mono", monospace`,
	);
	window.localStorage.setItem('otto-desktop-font-family', fontFamily);
};
```

### Session navigation from native notifications

Current:

```txt
notification click -> postMessage to iframe -> web router navigates
```

Target:

```txt
notification click -> DesktopWorkspaceApp sets activeSessionId
```

`DesktopWorkspaceApp` should expose/register:

```ts
window.OTTO_OPEN_SESSION = (sessionId) => setActiveSessionId(sessionId);
```

### Verification

Check:

- provider auth opens external browser through Tauri
- MCP auth opens external browser through Tauri
- share/tunnel links open externally
- native notifications appear
- notification click opens/focuses the right session
- system fonts load in settings
- font changes persist

## Phase 3: Remote Workspace Direct Mode

### Objective

Remote workspaces should render directly without starting a local web server.

Current remote path:

```ts
startWebServer(project.remoteUrl, project.name);
iframe src = local web server URL;
```

Target:

```ts
const apiUrl = project.remoteUrl;
configureDesktopSdk(apiUrl);
render <DesktopWorkspaceApp apiUrl={apiUrl} />;
```

### Changes

In `apps/desktop/src/components/Workspace.tsx`:

- If `project.remoteUrl` exists, skip `startWebServer`.
- Set workspace API URL to `project.remoteUrl`.
- Render the direct SDK workspace.
- Keep local loading/error state distinct from local server startup.

`startWebServer` can remain in the bridge temporarily until cleanup.

### Verification

Check:

- add/connect remote server from project picker
- sessions load from remote API
- creating/sending messages works
- streaming works
- error state is clear when remote API is unreachable

## Phase 4: Shared CSS/Theming Cleanup

### Objective

Ensure SDK workspace renders correctly in desktop.

`apps/desktop/src/index.css` is smaller than `apps/web/src/index.css`. The SDK workspace expects variables/classes from the web app, including:

- `--sidebar-background`
- `--sidebar-foreground`
- `--sidebar-border`
- `--sidebar-muted-foreground`
- `--code-background`
- `--code-foreground`
- syntax color vars
- `sidebar-fade-in`
- `animate-shimmer`

### First pass

Copy/merge missing vars and utility classes from:

```txt
apps/web/src/index.css
```

into:

```txt
apps/desktop/src/index.css
```

### Later refactor

Move shared SDK UI CSS into:

```txt
packages/web-sdk/src/styles.css
```

Then import it from both apps.

## Phase 5: API-Only Server Mode

### Objective

Stop starting the unused embedded web UI server for desktop local projects.

### Add CLI flag

Add to `otto serve`:

```bash
otto serve --api-only --port <port>
```

In `apps/cli/src/commands/serve.ts`:

- Add `apiOnly` to `ServeOptions`.
- Skip `createWebServer(...)` when `apiOnly` is true.
- Keep default CLI behavior unchanged: `otto serve` still starts API + Web UI.

### Update desktop Rust command

In `apps/desktop/src-tauri/src/commands/server.rs`, change local project startup from:

```rust
.args(["serve", "--port", &port_arg, "--no-open"])
```

to:

```rust
.args(["serve", "--api-only", "--port", &port_arg, "--no-open"])
```

### Verification

Check:

- desktop local projects still work
- `otto serve` still starts web UI by default
- `otto serve --api-only` starts only the API server
- TUI and browser web app behavior are unaffected

## Phase 6: Remove Obsolete Iframe/Web UI Desktop Code

### Objective

Clean up the old desktop iframe path once direct rendering is stable.

Remove from `Workspace.tsx`:

- `iframeRef`
- `iframeLoaded`
- `iframeSrc`
- `focusIframe`
- iframe keyboard focus handler
- iframe `postMessage` listener
- iframe theme posting
- iframe load handling

Remove or simplify:

- `startWebServer` usage in `apps/desktop/src/hooks/useServer.ts`
- `startWebServer` bridge in `apps/desktop/src/lib/tauri-bridge.ts`
- `start_web_server` Tauri command if no longer needed
- `webPort` display in the desktop title bar

Consider eventually changing `ServerInfo` to make API/web fields explicit:

```ts
interface ServerInfo {
	pid: number;
	port: number;
	apiUrl: string;
	webPort?: number;
	webUrl?: string;
	projectPath: string;
}
```

First pass can avoid this by deriving local API URL in TypeScript:

```ts
const apiUrl = `http://localhost:${server.port}`;
```

## Suggested Commit Sequence

### Commit 1: Direct local workspace prototype

- Add desktop direct workspace components.
- Configure SDK API base URL from local server port.
- Replace iframe with direct workspace for local projects.
- Keep `otto serve` unchanged.

### Commit 2: Desktop platform adapters

- Add SDK global adapter support for URL opening, notifications, system fonts, and session opening.
- Register Tauri implementations in desktop.
- Remove direct reliance on iframe `postMessage` for these behaviors.

### Commit 3: Direct remote workspace mode

- Stop using `startWebServer` for remote projects.
- Configure SDK directly with `project.remoteUrl`.
- Render the same desktop workspace component.

### Commit 4: API-only server mode

- Add `otto serve --api-only`.
- Update desktop Rust startup to use API-only mode.
- Keep default CLI/web behavior unchanged.

### Commit 5: Cleanup iframe remnants

- Remove obsolete iframe state/listeners/rendering.
- Remove unused `startWebServer` bridge/command if safe.
- Simplify server info display and docs.

## Files Likely Touched

Desktop:

```txt
apps/desktop/src/components/Workspace.tsx
apps/desktop/src/components/workspace/DesktopWorkspaceApp.tsx
apps/desktop/src/components/workspace/DesktopSessionsLayout.tsx
apps/desktop/src/components/workspace/DesktopAppLayout.tsx
apps/desktop/src/components/workspace/DesktopWorkspaceProvider.tsx
apps/desktop/src/hooks/useServer.ts
apps/desktop/src/lib/tauri-bridge.ts
apps/desktop/src/lib/sdk-client.ts
apps/desktop/src/index.css
apps/desktop/package.json
```

SDK:

```txt
packages/web-sdk/src/lib/open-url.ts
packages/web-sdk/src/hooks/useClientEvents.ts
packages/web-sdk/src/components/settings/SettingsSidebar.tsx
packages/web-sdk/src/lib/api-client/utils.ts
```

CLI/server cleanup:

```txt
apps/cli/src/commands/serve.ts
apps/desktop/src-tauri/src/commands/server.rs
apps/desktop/src-tauri/src/lib.rs
```

Possible web app files if shared shell is later extracted:

```txt
apps/web/src/components/sessions/SessionsLayout.tsx
apps/web/src/components/layout/AppLayout.tsx
apps/web/src/components/layout/Sidebar.tsx
```

## Risks and Gotchas

### SDK top-level browser assumptions

Some SDK code currently detects iframe mode. In direct desktop mode, it will see itself as top-level and may use `window.open` or browser `Notification`. Platform adapters should override those behaviors.

### Query cache leakage between projects

The API URL changes when switching projects. Use a fresh `QueryClient` per workspace/API URL.

### Multiple desktop windows

`configureApiClient()` mutates client config in the current JS context. This should be fine because each Tauri window has its own context, but avoid sharing a singleton query cache across project windows.

### CSS drift

The SDK workspace may look broken until desktop has all web CSS tokens/classes.

### Router assumptions

Some web code navigates with URLs like `/sessions/:id`. The desktop direct workspace should use stateful session navigation instead. Adapter-based session opening should replace browser URL navigation where needed.

### Existing unstaged changes

Before implementation, inspect current unstaged changes to avoid overwriting work:

```txt
apps/cli/src/commands/serve.ts
apps/desktop/src/components/Workspace.tsx
apps/web/src/components/sessions/SessionsLayout.tsx
packages/web-sdk/src/components/ui/Toaster.tsx
packages/web-sdk/src/hooks/useClientEvents.ts
packages/web-sdk/src/stores/toastStore.ts
```

## Definition of Done

The migration is done when:

- Desktop no longer renders the workspace in an iframe.
- Local project opens directly in desktop using SDK UI.
- Remote server opens directly in desktop using SDK UI.
- Session list/create/select works.
- Message streaming works.
- Git/files/terminals/settings/MCP panels work.
- External links open through Tauri.
- Native notifications work.
- Notification click focuses desktop and opens the correct session.
- Desktop no longer starts the embedded web UI server for workspace mode.
- Browser `apps/web` still works normally.
- Build/lint/tests pass:

```bash
bun run --cwd apps/desktop build
bun lint
bun test
```
