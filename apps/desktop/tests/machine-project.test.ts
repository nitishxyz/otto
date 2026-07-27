import { describe, expect, test } from 'bun:test';
import { toConnectedProject } from '../src/lib/machine-project';

describe('connected machine project context', () => {
	test('keeps owner session in runtime project state without putting it in the URL', () => {
		const project = toConnectedProject(
			{
				id: 'project-1',
				name: 'agi',
				path: '/work/agi',
				open: true,
				lastUsedAt: 1,
				pinned: true,
			},
			'https://device.ottorouter.org',
			'owner-session-secret',
			1_800_000_000_000,
			new Date('2026-07-11T00:00:00.000Z'),
		);

		expect(project.projectId).toBe('project-1');
		expect(project.machineOwnerSession).toBe('owner-session-secret');
		expect(project.machineOwnerSessionExpiresAt).toBe(1_800_000_000_000);
		expect(project.remoteUrl).toBe('https://device.ottorouter.org');
		expect(project.remoteUrl).not.toContain('owner-session-secret');
		expect(project.path).toBe('/work/agi');
		expect(project.pinned).toBe(true);
		expect(project.lastOpened).toBe(new Date(1).toISOString());
	});
});
