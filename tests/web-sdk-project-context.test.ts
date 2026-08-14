import { describe, expect, it } from 'bun:test';
import {
	buildClientEventsStreamUrl,
	buildProjectEventsStreamUrl,
	buildSessionStreamUrl,
} from '../packages/api/src/streaming.ts';

function installWindow(runtimeContext?: unknown) {
	(globalThis as unknown as { window: unknown }).window = {
		location: { search: '' },
		localStorage: {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {},
		},
		OTTO_SERVER_URL: 'http://127.0.0.1:4321',
		OTTO_RUNTIME_CONTEXT: runtimeContext,
	};
}

describe('web-sdk project context helpers', () => {
	it('reads initial runtime context from the web server bootstrap', async () => {
		installWindow({
			projectId: 'project-web',
			projectRoot: '/tmp/project-web',
			serverToken: 'token-web',
		});

		const { getRuntimeProjectContext } = await import(
			'../packages/web-sdk/src/lib/config.ts'
		);
		const { getProjectQuery, getAuthHeaders, projectScopedKey } = await import(
			'../packages/web-sdk/src/lib/api-client/utils.ts'
		);

		expect(getRuntimeProjectContext()).toEqual({
			projectId: 'project-web',
			projectRoot: '/tmp/project-web',
			serverToken: 'token-web',
		});
		expect(getProjectQuery()).toEqual({
			projectId: 'project-web',
			project: '/tmp/project-web',
		});
		expect(getAuthHeaders()).toEqual({
			Authorization: 'Bearer token-web',
			'X-Otto-Server-Token': 'token-web',
			'X-Otto-Project-Id': 'project-web',
			'X-Otto-Project': '/tmp/project-web',
		});
		expect(projectScopedKey(['sessions', 'list'] as const)).toEqual([
			'project',
			'project-web',
			'sessions',
			'list',
		]);
	});

	it('builds web stream URLs with projectId precedence', () => {
		expect(
			buildSessionStreamUrl({
				baseUrl: 'http://127.0.0.1:4321',
				sessionId: 'session-web',
				projectId: 'project-web',
				projectPath: '/tmp/project-web',
			}),
		).toBe(
			'http://127.0.0.1:4321/v1/sessions/session-web/stream?projectId=project-web',
		);
		expect(
			buildClientEventsStreamUrl({
				baseUrl: 'http://127.0.0.1:4321',
				projectId: 'project-web',
				projectPath: '/tmp/project-web',
			}),
		).toBe('http://127.0.0.1:4321/v1/events/stream?projectId=project-web');
		expect(
			buildProjectEventsStreamUrl({
				baseUrl: 'http://127.0.0.1:4321',
				projectId: 'project-web',
				sessionIds: ['session-main', 'session-child'],
			}),
		).toBe(
			'http://127.0.0.1:4321/v1/events/project?projectId=project-web&sessions=session-main%2Csession-child',
		);
	});

	it('calls project route client with runtime auth headers', async () => {
		installWindow({
			projectId: 'project-web',
			projectRoot: '/tmp/project-web',
			serverToken: 'token-web',
		});
		const originalFetch = globalThis.fetch;
		const calls: Array<{ url: string; token: string | null }> = [];
		globalThis.fetch = (async (url, init) => {
			const headers = new Headers(init?.headers);
			calls.push({
				url: String(url),
				token: headers.get('x-otto-server-token'),
			});
			return new Response(
				JSON.stringify({
					projects: [
						{
							id: 'project-web',
							name: 'project-web',
							path: '/tmp/project-web',
							stateDir: '/tmp/project-web/.otto',
							dbPath: '/tmp/project-web/.otto/otto.sqlite',
							lastUsedAt: 1,
							open: true,
						},
					],
				}),
				{ headers: { 'content-type': 'application/json' } },
			);
		}) as typeof fetch;

		try {
			const { listProjects } = await import(
				'../packages/web-sdk/src/lib/api-client/projects.ts'
			);
			const projects = await listProjects();
			expect(projects[0].id).toBe('project-web');
			expect(calls).toEqual([
				{
					url: 'http://127.0.0.1:4321/v1/projects',
					token: 'token-web',
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
