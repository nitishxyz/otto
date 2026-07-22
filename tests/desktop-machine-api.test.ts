import { afterAll, describe, expect, it, mock } from 'bun:test';
import * as apiActual from '@ottocode/api';
import type { MachineBootstrap } from '../apps/desktop/src/lib/tauri-bridge.ts';

const realApi = { ...apiActual };
const listProjectsMock = mock(async () => ({
	data: { status: 'unavailable', message: 'test' },
}));

mock.module('@ottocode/api', () => ({
	...realApi,
	listAuthorizedMachineProjects: listProjectsMock,
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
});
