import { describe, expect, it } from 'bun:test';
import { buildSessionStreamUrl } from '../packages/api/src/streaming.ts';
import {
	configureProjectContext,
	getBaseUrl,
	getProjectKey,
	getProjectQuery,
} from '../apps/tui/src/api.ts';

describe('TUI project context helpers', () => {
	it('stores daemon project context for API calls and cache keys', () => {
		configureProjectContext({
			baseUrl: 'http://127.0.0.1:4321',
			projectId: 'project-one',
			projectRoot: '/tmp/project-one',
			token: 'secret-token',
		});

		expect(getBaseUrl()).toBe('http://127.0.0.1:4321');
		expect(getProjectQuery()).toEqual({
			projectId: 'project-one',
			project: '/tmp/project-one',
		});
		expect(getProjectKey()).toBe('project-one');
	});

	it('builds session stream URLs with projectId before project path', () => {
		const url = buildSessionStreamUrl({
			baseUrl: 'http://127.0.0.1:4321',
			sessionId: 'session-1',
			projectId: 'project-one',
			projectPath: '/tmp/project-one',
		});

		expect(url).toBe(
			'http://127.0.0.1:4321/v1/sessions/session-1/stream?projectId=project-one',
		);
	});
});
