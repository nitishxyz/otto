import { describe, expect, test } from 'bun:test';
import { loadAuthorizedMachineProjects } from '../packages/server/src/routes/ottorouter/devices';

function requestUrl(input: string | URL | Request): string {
	if (typeof input === 'string') return input;
	return input instanceof URL ? input.href : input.url;
}

function ownerSessionHeader(init?: RequestInit): string | null {
	return new Headers(init?.headers).get('X-Otto-Owner-Session');
}

describe('OttoRouter machine projects', () => {
	test('renews a cached owner session rejected after a remote daemon restart', async () => {
		const deviceId = crypto.randomUUID();
		const machineId = crypto.randomUUID();
		let sessionExchanges = 0;
		let authorizations = 0;
		const projectTokens: Array<string | null> = [];
		const fetcher: typeof globalThis.fetch = async (input, init) => {
			const url = requestUrl(input);
			if (url.endsWith('/v1/tunnel/owner/challenge')) {
				return Response.json({
					challenge: 'a'.repeat(43),
					device_id: deviceId,
					machine_id: machineId,
				});
			}
			if (url.endsWith('/v1/tunnel/owner/session')) {
				sessionExchanges += 1;
				return Response.json({
					access_token: `owner-${sessionExchanges}`,
					expires_in: 600,
				});
			}
			if (url.endsWith('/v1/projects')) {
				const token = ownerSessionHeader(init);
				projectTokens.push(token);
				if (projectTokens.length === 2) {
					return Response.json({ error: 'Unauthorized' }, { status: 401 });
				}
				return Response.json({
					projects: [
						{
							id: 'project-1',
							name: 'Project',
							path: '/tmp/project',
							open: true,
							lastUsedAt: 1,
						},
					],
				});
			}
			if (url.endsWith('/v1/server/info')) {
				return Response.json({ version: '0.1.0' });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		const authorizeDevice = async () => {
			authorizations += 1;
			return Response.json({
				assertion: `assertion-${authorizations}`,
				device_id: deviceId,
				machine_id: machineId,
			});
		};

		const first = await loadAuthorizedMachineProjects(
			deviceId,
			machineId,
			'machine.ottorouter.org',
			false,
			{ fetcher, authorizeDevice },
		);
		const second = await loadAuthorizedMachineProjects(
			deviceId,
			machineId,
			'machine.ottorouter.org',
			false,
			{ fetcher, authorizeDevice },
		);

		expect(first.status).toBe('ready');
		expect(second.status).toBe('ready');
		expect(authorizations).toBe(2);
		expect(sessionExchanges).toBe(2);
		expect(projectTokens).toEqual(['owner-1', 'owner-1', 'owner-2']);
	});
});
