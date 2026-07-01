import { describe, expect, it } from 'bun:test';
import { formatProjectsList } from '../apps/cli/src/commands/projects.ts';
import {
	closeProjectOnServer,
	forgetProjectOnServer,
	listProjectsOnServer,
} from '../apps/cli/src/daemon.ts';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('CLI projects helpers', () => {
	it('formats open and known projects for terminal output', () => {
		const output = formatProjectsList([
			{
				id: 'project-a',
				name: 'alpha',
				path: '/tmp/alpha',
				stateDir: '/tmp/alpha/.otto',
				dbPath: '/tmp/alpha/.otto/otto.sqlite',
				lastUsedAt: 1_700_000_000_000,
				open: true,
			},
			{
				id: 'project-b',
				name: 'beta',
				path: '/tmp/beta',
				stateDir: '/tmp/beta/.otto',
				dbPath: '/tmp/beta/.otto/otto.sqlite',
				lastUsedAt: 1_600_000_000_000,
				open: false,
			},
		]);

		expect(output).toContain('* alpha');
		expect(output).toContain('id: project-a');
		expect(output).toContain('state: open');
		expect(output).toContain('  beta');
		expect(output).toContain('state: known');
	});

	it('calls project daemon routes with auth headers', async () => {
		const calls: Array<{ url: string; method: string; token: string | null }> =
			[];
		const fetchImpl: typeof fetch = async (url, init) => {
			const headers = new Headers(init?.headers);
			calls.push({
				url: String(url),
				method: init?.method ?? 'GET',
				token: headers.get('x-otto-server-token'),
			});
			return jsonResponse({ projects: [] });
		};

		await listProjectsOnServer({
			baseUrl: 'http://127.0.0.1:1234',
			token: 'token-1',
			fetch: fetchImpl,
		});
		await closeProjectOnServer({
			baseUrl: 'http://127.0.0.1:1234',
			projectId: 'project-1',
			token: 'token-1',
			fetch: fetchImpl,
		});
		await forgetProjectOnServer({
			baseUrl: 'http://127.0.0.1:1234',
			projectIdOrPath: '/tmp/project 1',
			token: 'token-1',
			fetch: fetchImpl,
		});

		expect(calls).toEqual([
			{
				url: 'http://127.0.0.1:1234/v1/projects',
				method: 'GET',
				token: 'token-1',
			},
			{
				url: 'http://127.0.0.1:1234/v1/projects/project-1/close',
				method: 'DELETE',
				token: 'token-1',
			},
			{
				url: 'http://127.0.0.1:1234/v1/projects/%2Ftmp%2Fproject%201',
				method: 'DELETE',
				token: 'token-1',
			},
		]);
	});
});
