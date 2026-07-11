import { describe, expect, test } from 'bun:test';
import {
	classifyProbeStatus,
	remoteDevicesOnly,
} from '../packages/server/src/routes/ottorouter/devices';

describe('OttoRouter desktop device list', () => {
	test('excludes the persisted local device id without hostname heuristics', () => {
		const devices = remoteDevicesOnly(
			[
				{ device_id: 'local-id', hostname: 'local.ottorouter.org' },
				{ device_id: 'remote-id', hostname: 'local.ottorouter.org' },
			],
			'local-id',
		);
		expect(devices).toEqual([
			{
				deviceId: 'remote-id',
				hostname: 'local.ottorouter.org',
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
