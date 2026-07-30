import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	DEFAULT_DAEMON_PORT,
	ensureDaemon,
	ensureDaemonToken,
	ensureDaemonProject,
	fetchDaemonHealth,
	getDaemonPaths,
	getPreferredDaemonPort,
	getDaemonSpawnCommand,
	getDaemonStatus,
	openProjectOnServer,
	readDaemonRegistration,
	readActiveDaemonSelection,
	removeDaemonRegistration,
	rotateDaemonPassword,
	startDaemon,
	stopDaemon,
	writeDaemonRegistration,
	writeActiveDaemonSelection,
	type DaemonPaths,
	type DaemonRegistration,
} from '../apps/cli/src/daemon.ts';
import {
	createSameOriginFetch,
	serveApi,
	spawnDaemonReplacement,
} from '../apps/cli/src/commands/serve.ts';
import { assetPaths } from '../apps/cli/src/web-assets.ts';
import { createWebUIFetch } from '../apps/cli/src/web-server.ts';

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

	it('spawns a detached replacement with stable handoff identity and port', () => {
		let spawnOptions: Parameters<typeof Bun.spawn>[0] | null = null;
		let unrefCalls = 0;
		spawnDaemonReplacement({
			projectRoot: '/tmp/project',
			executable: '/tmp/otto-staged',
			port: 49_999,
			daemonId: 'replacement-id',
			cwd: '/tmp',
			env: { PATH: '/bin' },
			spawn: ((options) => {
				spawnOptions = options;
				return {
					unref: () => {
						unrefCalls++;
					},
				} as ReturnType<typeof Bun.spawn>;
			}) as typeof Bun.spawn,
		});

		expect(spawnOptions).toMatchObject({
			cmd: [
				'/tmp/otto-staged',
				'serve',
				'--api-only',
				'--no-open',
				'--daemon-register',
				'--port',
				'49999',
				'--project',
				'/tmp/project',
			],
			cwd: '/tmp',
			env: {
				PATH: '/bin',
				OTTO_DAEMON_ID: 'replacement-id',
				OTTO_DAEMON_PORT: '49999',
			},
			stdin: 'ignore',
			stdout: 'ignore',
			stderr: 'ignore',
		});
		expect(unrefCalls).toBe(1);
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

	it('routes daemon APIs and browser navigation on the same origin', async () => {
		const apiFetch = (async (request: Request) =>
			new Response(`api:${new URL(request.url).pathname}`)) as NonNullable<
			Parameters<typeof Bun.serve>[0]['fetch']
		>;
		const routedFetch = createSameOriginFetch(
			apiFetch,
			createWebUIFetch(null),
		) as unknown as (request: Request) => Promise<Response>;

		for (const pathname of ['/v1/server/info', '/openapi.json']) {
			const response = await routedFetch(
				new Request(`https://device.example${pathname}`),
			);
			expect(await response.text()).toBe(`api:${pathname}`);
		}

		const navigation = await routedFetch(
			new Request('https://device.example/sessions/example'),
		);
		const html = await navigation.text();
		expect(navigation.headers.get('content-type')).toContain('text/html');
		expect(html).toContain('window.OTTO_SERVER_URL = "https://device.example"');

		const proxiedNavigation = await routedFetch(
			new Request('http://device.example/sessions/example', {
				headers: { 'X-Forwarded-Proto': 'https' },
			}),
		);
		expect(await proxiedNavigation.text()).toContain(
			'window.OTTO_SERVER_URL = "https://device.example"',
		);

		const asset = await routedFetch(
			new Request(`https://device.example${assetPaths.assets.js[0]}`),
		);
		expect(asset.status).toBe(200);
		expect(asset.headers.get('content-type')).toContain('javascript');
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

	it('persists a verified active daemon without overriding a newer install', async () => {
		const paths = await createDaemonPaths();
		const activePath = join(paths.dir, 'upgrades', '1.2.4', 'otto');
		await mkdir(join(paths.dir, 'upgrades', '1.2.4'), { recursive: true });
		await Bun.write(activePath, 'binary');
		await writeActiveDaemonSelection(
			{ path: activePath, version: '1.2.4' },
			{ paths },
		);

		expect(await readActiveDaemonSelection('1.2.3', { paths })).toEqual({
			path: activePath,
			version: '1.2.4',
		});
		expect(await readActiveDaemonSelection('1.2.5', { paths })).toBeNull();
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

	it('restarts authenticated daemon when ensuring with a newer version', async () => {
		const paths = await createDaemonPaths();
		const oldReg = registration({ version: '1.2.2' });
		const signaled: Array<[number, NodeJS.Signals | number | undefined]> = [];
		await ensureDaemonToken({ paths });
		await writeDaemonRegistration(oldReg, { paths });

		const ensured = await ensureDaemon({
			version: '1.2.3',
			paths,
			projectRoot: '/tmp/project',
			port: 49_124,
			fetch: async (url) => {
				const registered = await readDaemonRegistration({ paths });
				return jsonResponse({
					port: Number(new URL(String(url)).port),
					version: registered?.version ?? oldReg.version,
					pid: registered?.pid ?? oldReg.pid,
					daemonId: registered?.id ?? oldReg.id,
					startedAt: registered?.startedAt ?? oldReg.startedAt,
				});
			},
			signal: (pid, signal) => {
				signaled.push([pid, signal]);
				return true;
			},
			spawn: ((options) => {
				const id = options.env?.OTTO_DAEMON_ID;
				expect(typeof id).toBe('string');
				void writeDaemonRegistration(
					registration({
						id: String(id),
						version: '1.2.3',
						url: 'http://127.0.0.1:49124',
						pid: 49_124,
						startedAt: 3000,
					}),
					{ paths },
				);
				return {
					unref: () => {},
					exited: new Promise(() => {}),
				} as ReturnType<typeof Bun.spawn>;
			}) as typeof Bun.spawn,
		});

		expect(signaled).toEqual([[oldReg.pid, 'SIGTERM']]);
		expect(ensured.version).toBe('1.2.3');
		expect(ensured.url).toBe('http://127.0.0.1:49124');
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
