import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
	createDaemonApi,
	daemonAuthHeaders,
} from '../apps/cli/src/runtime/daemon-api.ts';
import { createServerRuntime } from '../apps/cli/src/runtime/server.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

async function temporaryProject() {
	const root = await mkdtemp(join(tmpdir(), 'otto-cli-runtime-'));
	temporaryDirectories.push(root);
	const project = join(root, 'project');
	await mkdir(project);
	return { root, project };
}

describe('CLI consolidated server runtime', () => {
	test('normalizes relative and symlinked project roots and serves generated operations', async () => {
		const { root, project } = await temporaryProject();
		const link = join(root, 'project-link');
		await symlink(project, link, 'dir');
		const relativeLink = relative(process.cwd(), link);
		const canonicalProject = await realpath(project);
		const previousDaemonId = process.env.OTTO_DAEMON_ID;
		delete process.env.OTTO_DAEMON_ID;

		const runtime = await createServerRuntime({
			projectRoot: relativeLink,
			version: '1.2.3',
			mode: 'foreground',
			webMode: 'disabled',
			port: 0,
			env: { PORT: '61234' },
		});
		try {
			expect(runtime.cfg.projectRoot).toBe(canonicalProject);
			expect(runtime.port).toBeGreaterThan(0);
			expect(runtime.apiUrl).toBe(`http://127.0.0.1:${runtime.port}`);

			const api = createDaemonApi({
				baseUrl: runtime.loopbackApiUrl,
				token: null,
			});
			const info = await api.getServerInfo();
			expect(info.port).toBe(runtime.port);
			expect(info.version).toBe('1.2.3');

			const opened = await api.openProject(project);
			expect(opened.path).toBe(canonicalProject);
			expect(
				(await api.listProjects()).some((item) => item.id === opened.id),
			).toBe(true);
			await api.closeProject(opened.id);
			await api.forgetProject(opened.id);
			expect(
				(await api.listProjects()).some((item) => item.id === opened.id),
			).toBe(false);
		} finally {
			await runtime.stop();
			if (previousDaemonId === undefined) delete process.env.OTTO_DAEMON_ID;
			else process.env.OTTO_DAEMON_ID = previousDaemonId;
		}
	});

	test('honors explicit port zero over PORT and stops only once', async () => {
		const { project } = await temporaryProject();
		let requestedPort: number | undefined;
		let stopCalls = 0;
		const serve = ((options: { port?: number }) => {
			requestedPort = options.port;
			return {
				port: 43123,
				stop: () => {
					stopCalls++;
				},
			};
		}) as unknown as typeof Bun.serve;
		const runtime = await createServerRuntime({
			projectRoot: project,
			mode: 'embedded',
			webMode: 'disabled',
			port: 0,
			env: { PORT: '61234' },
			serve,
		});

		expect(requestedPort).toBe(0);
		expect(runtime.port).toBe(43123);
		await Promise.all([runtime.stop(), runtime.stop()]);
		expect(stopCalls).toBe(1);
	});
});

describe('CLI daemon API factory', () => {
	test('uses canonical auth headers and formats generated API errors', async () => {
		const token = 'daemon-secret';
		expect(daemonAuthHeaders(token)).toEqual({
			Authorization: `Bearer ${token}`,
			'X-Otto-Server-Token': token,
		});
		let requestHeaders: Headers | null = null;
		const api = createDaemonApi({
			baseUrl: 'http://daemon.test',
			token,
			fetch: async (_input, init) => {
				requestHeaders = new Headers(init?.headers);
				return Response.json(
					{ error: 'denied' },
					{ status: 403, statusText: 'Forbidden' },
				);
			},
		});

		await expect(api.listProjects()).rejects.toThrow(
			'List projects failed (403 Forbidden): denied',
		);
		expect(requestHeaders?.get('authorization')).toBe(`Bearer ${token}`);
		expect(requestHeaders?.get('x-otto-server-token')).toBe(token);
	});
});
