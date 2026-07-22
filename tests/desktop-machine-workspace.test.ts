import { describe, expect, it } from 'bun:test';
import { resolveWorkspaceSdkConfiguration } from '../apps/desktop/src/lib/workspace-sdk-config.ts';
import type {
	Project,
	ServerInfo,
} from '../apps/desktop/src/lib/tauri-bridge.ts';

const machineProject: Project = {
	path: '/srv/project',
	name: 'Remote project',
	lastOpened: '2026-07-21T00:00:00.000Z',
	pinned: false,
	kind: 'remote',
	remoteUrl: 'https://machine.ottorouter.test',
	projectId: 'project-id',
	machineOwnerSession: 'owner-token',
	machineOwnerSessionExpiresAt: 123_456,
};

describe('desktop machine workspace SDK configuration', () => {
	it('preserves machine project and owner credentials in the open workspace', () => {
		expect(
			resolveWorkspaceSdkConfiguration(
				'https://machine.ottorouter.test',
				null,
				machineProject,
			),
		).toEqual({
			kind: 'machine',
			apiUrl: 'https://machine.ottorouter.test',
			projectId: 'project-id',
			projectRoot: '/srv/project',
			ownerSession: 'owner-token',
			ownerSessionExpiresAt: 123_456,
		});
	});

	it('applies renewed credentials without changing the workspace identity', () => {
		const renewed = resolveWorkspaceSdkConfiguration(
			'https://machine.ottorouter.test',
			null,
			{
				...machineProject,
				machineOwnerSession: 'renewed-token',
				machineOwnerSessionExpiresAt: 456_789,
			},
		);

		expect(renewed).toMatchObject({
			kind: 'machine',
			projectId: 'project-id',
			ownerSession: 'renewed-token',
			ownerSessionExpiresAt: 456_789,
		});
	});

	it('keeps local projects on the desktop daemon configuration', () => {
		const server = {
			url: 'http://127.0.0.1:9100',
			projectId: 'local-id',
			projectPath: '/work/local',
		} as ServerInfo;
		const localProject: Project = {
			path: '/work/local',
			name: 'Local project',
			lastOpened: '2026-07-21T00:00:00.000Z',
			pinned: false,
			kind: 'local',
		};

		expect(
			resolveWorkspaceSdkConfiguration(server.url, server, localProject),
		).toEqual({ kind: 'desktop', apiUrl: server.url, server });
	});
});
