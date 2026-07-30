import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('remote machine settings', () => {
	test('adds a third remote picker action and a guarded route', async () => {
		const [picker, router] = await Promise.all([
			readFile(
				new URL(
					'../src/components/ConnectedProjectPicker.tsx',
					import.meta.url,
				),
				'utf8',
			),
			readFile(new URL('../src/router.tsx', import.meta.url), 'utf8'),
		]);

		expect(picker).toContain('sm:grid-cols-3');
		expect(picker).toContain("navigate({ to: '/machine-settings' })");
		expect(picker).toContain('Settings & updates');
		expect(router).toContain("path: 'machine-settings'");
		expect(router).toContain('RemoteMachineSettings');
		expect(router).toContain('if (!machine || !daemon)');
	});

	test('checks owner-authorized status and only stages supported upgrades', async () => {
		const settings = await readFile(
			new URL('../src/components/RemoteMachineSettings.tsx', import.meta.url),
			'utf8',
		);

		expect(settings).toContain('loadAuthorizedMachineProjects');
		expect(settings).toContain('REMOTE_UPGRADE_CAPABILITY');
		expect(settings).toContain('isStrictlyNewerRelease');
		expect(settings).toContain('stageRemoteHostUpgrade');
		expect(settings).toContain('Stage update');
		expect(settings).toContain('otto service restart');
		expect(settings).toContain('restartRemoteHost');
		expect(settings).toContain('REMOTE_RESTART_CAPABILITY');
		expect(settings).toContain('Restart & apply');
	});
});
