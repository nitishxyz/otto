import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('same-window machine navigation', () => {
	test('selects the machine in app state without opening another window', async () => {
		const [app, launcher, bridge] = await Promise.all([
			readFile('src/App.tsx', 'utf8'),
			readFile('src/components/MachineLauncher.tsx', 'utf8'),
			readFile('src/lib/tauri-bridge.ts', 'utf8'),
		]);

		expect(launcher).toContain('await onSelectMachine(device)');
		expect(launcher).not.toContain('openMachineWindow');
		expect(app).toContain('handleSelectMachine');
		expect(app).toContain('setMachine(bootstrap)');
		expect(app).toContain("to: '/projects', replace: true");
		expect(bridge).toContain(
			"invoke<MachineBootstrap | null>('set_current_machine'",
		);
	});

	test('connected picker can return the same window to local projects', async () => {
		const [app, picker] = await Promise.all([
			readFile('src/App.tsx', 'utf8'),
			readFile('src/components/ConnectedProjectPicker.tsx', 'utf8'),
		]);

		expect(picker).toContain('onLeaveMachine');
		expect(picker).toContain('<TitleBar');
		expect(picker).toContain(
			"leadingInset={platform === 'macos' && !isFullscreen}",
		);
		expect(app).toContain('handleLeaveMachine');
		expect(app).toContain('setCurrentMachine(null)');
		expect(app).toContain('setMachine(null)');
	});
});
