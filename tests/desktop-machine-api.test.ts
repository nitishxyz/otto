import { afterAll, describe, expect, it, mock } from 'bun:test';
import * as apiActual from '@ottocode/api';
import type { MachineBootstrap } from '../apps/desktop/src/lib/tauri-bridge.ts';

const realApi = { ...apiActual };
const listProjectsMock = mock(async () => ({
	data: { status: 'unavailable', message: 'test' },
}));
const listDirectoriesMock = mock(async () => ({
	data: { path: '/srv', parent: '/', directories: [], truncated: false },
}));
const openProjectMock = mock(async () => ({
	data: {
		id: 'project-1',
		name: 'project',
		path: '/srv/project',
		open: true,
		lastUsedAt: 1,
		pinned: false,
	},
}));
const openGeneralProjectMock = mock(async () => ({
	data: {
		id: 'general-1',
		name: 'general',
		path: '/srv/general',
		open: true,
		lastUsedAt: 1,
		pinned: false,
	},
}));

mock.module('@ottocode/api', () => ({
	...realApi,
	listAuthorizedMachineProjects: listProjectsMock,
	listProjectDirectories: listDirectoriesMock,
	openProject: openProjectMock,
	openGeneralProject: openGeneralProjectMock,
}));

afterAll(() => {
	mock.module('@ottocode/api', () => realApi);
});

const machineApiPromise = import('../apps/desktop/src/lib/machine-api.ts');

describe('desktop machine API routing', () => {
	it('always brokers project authorization through the local daemon', async () => {
		const machine: MachineBootstrap = {
			deviceId: 'remote-device',
			hostname: 'remote-device.ottorouter.test',
			name: 'Remote machine',
		};
		const { loadAuthorizedMachineProjects } = await machineApiPromise;

		await loadAuthorizedMachineProjects(machine, 'http://127.0.0.1:9100', true);

		expect(listProjectsMock).toHaveBeenCalledWith({
			baseURL: 'http://127.0.0.1:9100',
			body: {
				deviceId: 'remote-device',
				hostname: 'remote-device.ottorouter.test',
				forceOwnerSession: true,
			},
		});
	});

	it('sends browsing and project actions directly to the authorized host', async () => {
		const access = {
			status: 'ready' as const,
			apiUrl: 'https://remote.ottorouter.test',
			ownerSession: 'owner-secret',
			ownerSessionExpiresAt: Date.now() + 60_000,
			projects: [],
		};
		const {
			loadMachineDirectories,
			openMachineGeneralProject,
			openMachineProject,
		} = await machineApiPromise;

		await loadMachineDirectories(access, '/srv');
		await openMachineProject(access, '/srv/project');
		await openMachineGeneralProject(access);

		const target = {
			baseURL: 'https://remote.ottorouter.test',
			headers: { 'X-Otto-Owner-Session': 'owner-secret' },
		};
		expect(listDirectoriesMock).toHaveBeenCalledWith({
			...target,
			query: { path: '/srv' },
		});
		expect(openProjectMock).toHaveBeenCalledWith({
			...target,
			body: { path: '/srv/project' },
		});
		expect(openGeneralProjectMock).toHaveBeenCalledWith(target);
	});
});
