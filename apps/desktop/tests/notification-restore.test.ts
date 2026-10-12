import { describe, expect, test } from 'bun:test';
import { restoreNotificationProject } from '../src/lib/notification-restore';
import type { NotificationWindowContext } from '../src/lib/notification-routing';
import type {
	MachineBootstrap,
	MachineProjectAccess,
} from '../src/lib/tauri-bridge';

const machineA: MachineBootstrap = {
	deviceId: 'device-a',
	machineId: 'machine-a',
	hostname: 'machine-a.test',
};
const machineB: MachineBootstrap = {
	deviceId: 'device-b',
	machineId: 'machine-b',
	hostname: 'machine-b.test',
};
const snapshot: NotificationWindowContext = {
	workspace: {
		serverUrl: 'https://machine-a.test/',
		projectId: 'project-a',
		projectPath: '/a',
	},
	project: {
		path: '/a',
		name: 'A',
		lastOpened: '',
		kind: 'remote',
		projectId: 'project-a',
	},
	sessionId: 'session-a',
	machine: { ...machineA },
};
const access: MachineProjectAccess = {
	status: 'ready',
	apiUrl: 'https://machine-a.test/',
	ownerSession: 'newly-authorized-token',
	ownerSessionExpiresAt: 100,
	projects: [
		{
			id: 'project-a',
			path: '/a',
			name: 'A',
			open: true,
			pinned: false,
			lastUsedAt: 0,
		},
	],
};

describe('notification machine fallback', () => {
	test('source switching machines while reauthorization is pending does not change captured routing', async () => {
		let sourceMachine = { ...machineA };
		let finish!: (value: MachineProjectAccess) => void;
		const pending = new Promise<MachineProjectAccess>((resolve) => {
			finish = resolve;
		});
		const requests: Array<{ machine: MachineBootstrap; force: boolean }> = [];
		const restoring = restoreNotificationProject(
			snapshot,
			sourceMachine,
			'http://localhost:9999',
			async (machine, url, force) => {
				expect(url).toBe('http://localhost:9999');
				requests.push({ machine, force });
				return pending;
			},
		);
		Object.assign(sourceMachine, machineB);
		sourceMachine = machineB;
		finish(access);
		const restored = await restoring;
		expect(requests).toEqual([{ machine: machineA, force: true }]);
		expect(sourceMachine).toEqual(machineB);
		expect(restored.projectId).toBe('project-a');
		expect(restored.remoteUrl).toBe('https://machine-a.test/');
		expect(restored.machineOwnerSession).toBe('newly-authorized-token');
		expect(snapshot.project.machineOwnerSession).toBeUndefined();
		expect(snapshot.machine).toEqual(machineA);
	});

	test('rejects current source machine B for captured project A without authorizing B', async () => {
		let calls = 0;
		await expect(
			restoreNotificationProject(
				snapshot,
				machineB,
				'http://localhost',
				async () => {
					calls += 1;
					return access;
				},
			),
		).rejects.toThrow('Notification machine routing changed.');
		expect(calls).toBe(0);
	});

	test('unavailable authorization never restores saved credentials', async () => {
		await expect(
			restoreNotificationProject(
				snapshot,
				machineA,
				'http://localhost',
				async () => {
					await Promise.resolve();
					return { status: 'offline', message: 'Machine offline' };
				},
			),
		).rejects.toThrow('Machine offline');
	});

	test('rejects an identical project ID with a different workspace path after authorization', async () => {
		await expect(
			restoreNotificationProject(
				snapshot,
				machineA,
				'http://localhost',
				async () => {
					await Promise.resolve();
					return {
						...access,
						projects: [{ ...access.projects[0], path: '/b' }],
					};
				},
			),
		).rejects.toThrow('Notification project is no longer available.');
	});
});
