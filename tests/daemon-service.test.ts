import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	DEFAULT_DAEMON_PORT,
	ensureDaemonToken,
	ensureDaemonProject,
	fetchDaemonHealth,
	getDaemonPaths,
	getPreferredDaemonPort,
	getDaemonSpawnCommand,
	getDaemonStatus,
	openProjectOnServer,
	readDaemonRegistration,
	removeDaemonRegistration,
	rotateDaemonPassword,
	startDaemon,
	stopDaemon,
	writeDaemonRegistration,
	type DaemonPaths,
	type DaemonRegistration,
} from '../apps/cli/src/daemon.ts';
import { serveApi } from '../apps/cli/src/commands/serve.ts';

const tempRoots: string[] = [];

async function createDaemonPaths(): Promise<DaemonPaths> {
	const root = await mkdtemp(join(tmpdir(), 'otto-daemon-test-'));
	tempRoots.push(root);
	await mkdir(root, { recursive: true });
	return {
		dir: root,
		registrationPath: join(root, 'server.json'),
		tokenPath: join(root, 'server-token'),
	};
}

function registration(
	overrides: Partial<DaemonRegistration> = {},
): DaemonRegistration {
	return {
		id: 'daemon-test-id',
		version: '1.2.3',
		url: 'http://127.0.0.1:12345',
		pid: 12345,
		startedAt: 1000,
		...overrides,
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

afterEach(async () => {
	for (const root of tempRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe('daemon service', () => {
	it('spawns source daemon through bun and compiled daemon directly', () => {
		expect(getDaemonSpawnCommand('/tmp/project', '/usr/local/bin/bun')).toEqual(
			[
				'/usr/local/bin/bun',
				'run',
				'apps/cli/index.ts',
				'serve',
				'--api-only',
				'--no-open',
				'--daemon-register',
				'--port',
				String(DEFAULT_DAEMON_PORT),
				'--project',
				'/tmp/project',
			],
		);
		expect(getDaemonSpawnCommand('/tmp/project', '/tmp/dist/otto')).toEqual([
			'/tmp/dist/otto',
			'serve',
			'--api-only',
			'--no-open',
			'--daemon-register',
			'--port',
			String(DEFAULT_DAEMON_PORT),
			'--project',
			'/tmp/project',
		]);
		expect(
			getDaemonSpawnCommand('/tmp/project', '/tmp/dist/otto', 49_999),
		).toEqual([
			'/tmp/dist/otto',
			'serve',
			'--api-only',
			'--no-open',
			'--daemon-register',
			'--port',
			'49999',
			'--project',
			'/tmp/project',
		]);
	});

	it('uses the documented daemon port by default and allows env override', () => {
		expect(getPreferredDaemonPort(undefined, {})).toBe(DEFAULT_DAEMON_PORT);
		expect(
			getPreferredDaemonPort(undefined, { OTTO_DAEMON_PORT: '49001' }),
		).toBe(49_001);
		expect(getPreferredDaemonPort(49_002, { OTTO_DAEMON_PORT: '49001' })).toBe(
			49_002,
		);
	});

	it('fails without fallback when the daemon port is unavailable', () => {
		const requestedPorts: number[] = [];
		expect(() =>
			serveApi({
				port: DEFAULT_DAEMON_PORT,
				hostname: '127.0.0.1',
				fetch: async () => new Response('ok'),
				serve: ((options) => {
					requestedPorts.push(Number(options.port));
					throw new Error('address already in use');
				}) as typeof Bun.serve,
			}),
		).toThrow('address already in use');

		expect(requestedPorts).toEqual([DEFAULT_DAEMON_PORT]);
	});

	it('reports daemon startup failure without writing registration', async () => {
		const paths = await createDaemonPaths();
		await expect(
			startDaemon({
				version: '1.2.3',
				paths,
				projectRoot: '/tmp/project',
				port: 49_123,
				spawn: (() =>
					({
						unref: () => {},
						exited: Promise.resolve(1),
					}) as ReturnType<typeof Bun.spawn>) as typeof Bun.spawn,
			}),
		).rejects.toThrow('otto daemon failed to start on port 49123');

		expect(await readDaemonRegistration({ paths })).toBeNull();
	});

	it('stores default daemon files under global state', () => {
		const originalOttoHome = process.env.OTTO_HOME;
		process.env.OTTO_HOME = '/tmp/otto-state-home';
		try {
			const paths = getDaemonPaths();

			expect(paths.dir).toBe('/tmp/otto-state-home');
			expect(paths.registrationPath).toBe('/tmp/otto-state-home/server.json');
			expect(paths.tokenPath).toBe('/tmp/otto-state-home/server-token');
		} finally {
			if (originalOttoHome === undefined) {
				delete process.env.OTTO_HOME;
			} else {
				process.env.OTTO_HOME = originalOttoHome;
			}
		}
	});

	it('creates and rotates local token with restrictive permissions', async () => {
		const paths = await createDaemonPaths();
		const token = await ensureDaemonToken({ paths });
		const tokenStat = await stat(paths.tokenPath);

		expect(token.length).toBeGreaterThan(32);
		expect(tokenStat.mode & 0o777).toBe(0o600);

		const rotated = await rotateDaemonPassword({ paths });
		const rotatedStat = await stat(paths.tokenPath);

		expect(rotated).not.toBe(token);
		expect(rotatedStat.mode & 0o777).toBe(0o600);
	});

	it('removes stale registration when health check fails', async () => {
		const paths = await createDaemonPaths();
		const reg = registration();
		await ensureDaemonToken({ paths });
		await writeDaemonRegistration(reg, { paths });

		const status = await getDaemonStatus({
			version: '1.2.3',
			paths,
			fetch: async () => jsonResponse({ error: 'nope' }, 503),
		});

		expect(status.state).toBe('stale');
		expect(status.state === 'stale' ? status.reason : '').toBe(
			'health check failed',
		);
		expect(await readDaemonRegistration({ paths })).toBeNull();
	});

	it('reports version mismatch without removing registration', async () => {
		const paths = await createDaemonPaths();
		const reg = registration({ version: '1.2.2' });
		await ensureDaemonToken({ paths });
		await writeDaemonRegistration(reg, { paths });

		const status = await getDaemonStatus({
			version: '1.2.3',
			paths,
			fetch: async () =>
				jsonResponse({
					port: 12345,
					version: '1.2.2',
					pid: reg.pid,
					daemonId: reg.id,
					startedAt: 2000,
				}),
		});

		expect(status.state).toBe('stale');
		expect(status.state === 'stale' ? status.reason : '').toBe(
			'version mismatch',
		);
		expect(await readDaemonRegistration({ paths })).toEqual(reg);

		await removeDaemonRegistration({ paths });
	});

	it('sends bearer and token headers when fetching health', async () => {
		const paths = await createDaemonPaths();
		const reg = registration();
		const token = await ensureDaemonToken({ paths });

		const health = await fetchDaemonHealth(reg, {
			paths,
			fetch: async (_url, init) => {
				const headers = new Headers(init?.headers);
				expect(headers.get('authorization')).toBe(`Bearer ${token}`);
				expect(headers.get('x-otto-server-token')).toBe(token);
				return jsonResponse({
					port: 12345,
					version: reg.version,
					pid: reg.pid,
					daemonId: reg.id,
					startedAt: 2000,
				});
			},
		});

		expect(health?.daemonId).toBe(reg.id);
		expect(health?.version).toBe(reg.version);
	});

	it('reads and writes daemon registration atomically', async () => {
		const paths = await createDaemonPaths();
		const original = registration({ id: 'original' });
		const next = registration({ id: 'next' });

		await writeFile(paths.registrationPath, `${JSON.stringify(original)}\n`);
		await writeDaemonRegistration(next, { paths });

		expect(await readDaemonRegistration({ paths })).toEqual(next);
	});

	it('stops authenticated daemon even when registration version is old', async () => {
		const paths = await createDaemonPaths();
		const reg = registration({ version: '1.2.2' });
		const signaled: Array<[number, NodeJS.Signals | number | undefined]> = [];
		await ensureDaemonToken({ paths });
		await writeDaemonRegistration(reg, { paths });

		const stopped = await stopDaemon({
			paths,
			fetch: async () =>
				jsonResponse({
					port: 12345,
					version: '1.2.2',
					pid: reg.pid,
					daemonId: reg.id,
					startedAt: 2000,
				}),
			signal: (pid, signal) => {
				signaled.push([pid, signal]);
				return true;
			},
		});

		expect(stopped).toBe(true);
		expect(signaled).toEqual([[reg.pid, 'SIGTERM']]);
		expect(await readDaemonRegistration({ paths })).toBeNull();
	});

	it('opens a project on an existing daemon with auth headers', async () => {
		const paths = await createDaemonPaths();
		const token = await ensureDaemonToken({ paths });
		const requests: Array<{ url: string; headers: Headers; body: unknown }> =
			[];

		const context = await openProjectOnServer({
			baseUrl: 'http://127.0.0.1:12345',
			projectRoot: '/tmp/example-project',
			token,
			fetch: async (url, init) => {
				requests.push({
					url: String(url),
					headers: new Headers(init?.headers),
					body: JSON.parse(String(init?.body)),
				});
				return jsonResponse({
					id: 'example-id',
					path: '/tmp/example-project',
				});
			},
		});

		expect(requests[0].url).toBe('http://127.0.0.1:12345/v1/projects/open');
		expect(requests[0].headers.get('authorization')).toBe(`Bearer ${token}`);
		expect(requests[0].headers.get('x-otto-server-token')).toBe(token);
		expect(requests[0].body).toEqual({ path: '/tmp/example-project' });
		expect(context.projectId).toBe('example-id');
		expect(context.projectRoot).toBe('/tmp/example-project');
		expect(context.authHeaders.Authorization).toBe(`Bearer ${token}`);
	});

	it('ensures daemon and opens selected project', async () => {
		const paths = await createDaemonPaths();
		const reg = registration();
		await ensureDaemonToken({ paths });
		await writeDaemonRegistration(reg, { paths });

		const seenUrls: string[] = [];
		const context = await ensureDaemonProject({
			version: reg.version,
			paths,
			projectRoot: '/tmp/current-project',
			fetch: async (url) => {
				seenUrls.push(String(url));
				if (String(url).endsWith('/v1/server/info')) {
					return jsonResponse({
						port: 12345,
						version: reg.version,
						pid: reg.pid,
						daemonId: reg.id,
						startedAt: 2000,
					});
				}
				return jsonResponse({
					id: 'current-id',
					path: '/tmp/current-project',
				});
			},
		});

		expect(seenUrls).toEqual([
			'http://127.0.0.1:12345/v1/server/info',
			'http://127.0.0.1:12345/v1/projects/open',
		]);
		expect(context.baseUrl).toBe(reg.url);
		expect(context.projectId).toBe('current-id');
	});
});
