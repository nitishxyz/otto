import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const LANDING_FILES = [
	'src/components/ProjectPicker.tsx',
	'src/components/MachineLauncher.tsx',
	'src/components/ConnectedProjectPicker.tsx',
	'src/hooks/useProjects.ts',
	'src/lib/machine-api.ts',
];

const FORBIDDEN_NATIVE_OPERATIONS = [
	'getRecentProjects',
	'saveRecentProject',
	'removeRecentProject',
	'toggleProjectPinned',
	'getGeneralWorkspacePath',
	'listTunnelDevices',
	'probeTunnelDevices',
	'getMachineProjects',
];

describe('desktop landing native boundary', () => {
	test('projects, auth, reachability, and machine data use daemon APIs', async () => {
		for (const path of LANDING_FILES) {
			const source = await readFile(path, 'utf8');
			for (const operation of FORBIDDEN_NATIVE_OPERATIONS) {
				expect(source).not.toContain(operation);
			}
		}
	});

	test('native landing calls are limited to dialogs and current-window context', async () => {
		const projects = await readFile('src/hooks/useProjects.ts', 'utf8');
		expect(projects).toContain('openProjectDialog');
		const machines = await readFile(
			'src/components/MachineLauncher.tsx',
			'utf8',
		);
		expect(machines).toContain('onSelectMachine');
		expect(machines).not.toContain('openMachineWindow');
		const bridge = await readFile('src/lib/tauri-bridge.ts', 'utf8');
		expect(bridge).toContain('setCurrentMachine');
	});

	test('remove action is explicitly list-only and preserves project files', async () => {
		const card = await readFile('src/components/ProjectCard.tsx', 'utf8');
		expect(card).toContain('Remove from list');
		expect(card).toContain('Project files will not be deleted.');
		expect(card).not.toContain('Delete project');
	});
});
