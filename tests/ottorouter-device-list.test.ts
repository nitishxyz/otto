import { describe, expect, test } from 'bun:test';
import {
	classifyProbeStatus,
	remoteDevicesOnly,
} from '../packages/server/src/routes/ottorouter/devices';

describe('OttoRouter desktop device list', () => {
	test('excludes only the local machine while retaining the same Otto instance', () => {
		const devices = remoteDevicesOnly(
			[
				{
					device_id: 'shared-device',
					machine_id: 'local-machine',
					hostname: 'local.ottorouter.org',
				},
				{
					device_id: 'shared-device',
					machine_id: 'remote-machine',
					hostname: 'remote.ottorouter.org',
				},
			],
			'shared-device',
			'local-machine',
		);
		expect(devices).toEqual([
			{
				deviceId: 'shared-device',
				machineId: 'remote-machine',
				hostname: 'remote.ottorouter.org',
				name: null,
				status: null,
			},
		]);
	});

	test('classifies daemon responses separately from edge outages', () => {
		expect(classifyProbeStatus(200)).toBe('online');
		expect(classifyProbeStatus(401)).toBe('online');
		expect(classifyProbeStatus(530)).toBe('offline');
		expect(classifyProbeStatus(523)).toBe('offline');
		expect(classifyProbeStatus(500)).toBe('checking');
	});
});
