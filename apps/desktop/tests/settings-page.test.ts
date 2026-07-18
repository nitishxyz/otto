import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('desktop settings page', () => {
	test('is reachable from both landing experiences', async () => {
		const localLanding = await readFile(
			'src/components/ProjectPicker.tsx',
			'utf8',
		);
		const connectedLanding = await readFile(
			'src/components/ConnectedProjectPicker.tsx',
			'utf8',
		);
		const router = await readFile('src/router.tsx', 'utf8');

		expect(localLanding).toContain("navigate({ to: '/settings' })");
		expect(connectedLanding).toContain("navigate({ to: '/settings' })");
		expect(router).toContain("path: 'settings'");
		expect(router).toContain('<DesktopSettings');
	});

	test('offers theme, update, and daemon lifecycle controls', async () => {
		const settings = await readFile(
			'src/components/DesktopSettings.tsx',
			'utf8',
		);

		expect(settings).toContain('themeList.map');
		expect(settings).toContain('Download update');
		expect(settings).toContain('Start daemon');
		expect(settings).toContain('Stop daemon');
		expect(settings).toContain('onRestartDaemon');
	});

	test('keeps the desktop shell as the only theme writer', async () => {
		const layout = await readFile(
			'src/components/workspace/DesktopSessionsLayout.tsx',
			'utf8',
		);
		const theme = await readFile('src/theme.ts', 'utf8');

		expect(layout).not.toContain('\tuseTheme,');
		expect(layout).not.toContain('useTheme();');
		expect(theme).toContain('useConfig({ enabled: serverReady })');
		expect(theme).toContain('useUpdateDefaults()');
		expect(theme).not.toContain('apiClient.updateDefaults');
	});

	test('uses the shared TitleBar with macOS inset and a back action', async () => {
		const settings = await readFile(
			'src/components/DesktopSettings.tsx',
			'utf8',
		);

		expect(settings).toContain('<TitleBar');
		expect(settings).toContain(
			"leadingInset={platform === 'macos' && !isFullscreen}",
		);
		expect(settings).toContain('showSidebarToggle={false}');
		expect(settings).toContain('onBack={() => void handleBackToProjects()}');
		expect(settings).toContain('<OttoWordmark');
	});

	test('appearance is a collapsed-by-default expandable card with optimistic theme state', async () => {
		const settings = await readFile(
			'src/components/DesktopSettings.tsx',
			'utf8',
		);

		expect(settings).toContain('useState(false)');
		expect(settings).toContain('aria-expanded={appearanceOpen}');
		expect(settings).toContain('{selectedThemeName}');
		expect(settings).toContain('setSelectedTheme(themeId)');
		expect(settings).toContain('setTheme(themeId)');
		expect(settings).toContain('setSelectedTheme(theme)');
		expect(settings).toContain('<AnimatePresence initial={false}>');
		expect(settings).toContain("animate={{ height: 'auto', opacity: 1 }}");
		expect(settings).toContain(
			'animate={{ rotate: appearanceOpen ? 180 : 0 }}',
		);
	});

	test('checks the installed CLI on startup and offers a bundled update', async () => {
		const app = await readFile('src/App.tsx', 'utf8');
		const settings = await readFile(
			'src/components/DesktopSettings.tsx',
			'utf8',
		);
		const bridge = await readFile('src/lib/tauri-bridge.ts', 'utf8');
		const native = await readFile('src-tauri/src/commands/server.rs', 'utf8');

		expect(app).toContain('.getCliSelection()');
		expect(settings).toContain('cliSelection?.updateAvailable');
		expect(settings).toContain('Update CLI');
		expect(bridge).toContain(
			"invoke<CliSelectionInfo>('update_installed_cli')",
		);
		expect(native).toContain('pub async fn update_installed_cli');
		expect(native).toContain('replace_cli_binary(');
		expect(native).toContain('Copied CLI version mismatch');
		expect(native).toContain('installed PATH CLI');
		expect(native).toContain('.join(".local").join("bin")');
	});

	test('refreshes router settings context immediately after a CLI update', async () => {
		const app = await readFile('src/App.tsx', 'utf8');

		expect(app).toContain('flushSync(() => setCliSelection(selection))');
		expect(app).toContain('await router.invalidate()');
	});

	test('parallelizes post-daemon bootstrap work', async () => {
		const app = await readFile('src/App.tsx', 'utf8');

		expect(app).toContain('await Promise.all([');
		expect(app).toContain('tauriBridge.getMachineBootstrap()');
		expect(app).toContain('tauriBridge.getInitialProject()');
		expect(app).toContain('tauriBridge.getInitialRemote()');
	});

	test('native stop command terminates the registered daemon safely', async () => {
		const bridge = await readFile('src/lib/tauri-bridge.ts', 'utf8');
		const native = await readFile('src-tauri/src/commands/server.rs', 'utf8');
		const registration = await readFile('src-tauri/src/lib.rs', 'utf8');

		expect(bridge).toContain("invoke('stop_desktop_daemon')");
		expect(native).toContain('pub async fn stop_desktop_daemon');
		expect(native).toContain(
			'stop_registered_daemon(&registration, &token).await',
		);
		expect(registration).toContain('commands::server::stop_desktop_daemon');
	});
});
