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
