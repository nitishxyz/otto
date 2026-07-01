import { OpenAPIHono } from '@hono/zod-openapi';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerRootRoutes } from '../packages/server/src/routes/root.ts';

const tempRoots: string[] = [];

async function withDaemonAuthEnv<T>(run: (stateDir: string) => Promise<T>) {
	const root = await mkdtemp(join(tmpdir(), 'otto-server-auth-test-'));
	tempRoots.push(root);
	const originalOttoHome = process.env.OTTO_HOME;
	const originalDaemonId = process.env.OTTO_DAEMON_ID;
	process.env.OTTO_HOME = root;
	process.env.OTTO_DAEMON_ID = 'daemon-test-id';
	try {
		return await run(root);
	} finally {
		if (originalOttoHome === undefined) {
			delete process.env.OTTO_HOME;
		} else {
			process.env.OTTO_HOME = originalOttoHome;
		}
		if (originalDaemonId === undefined) {
			delete process.env.OTTO_DAEMON_ID;
		} else {
			process.env.OTTO_DAEMON_ID = originalDaemonId;
		}
	}
}

afterEach(async () => {
	for (const root of tempRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe('server root auth', () => {
	it('authorizes daemon health using the token from global state', async () => {
		await withDaemonAuthEnv(async (stateDir) => {
			await mkdir(stateDir, { recursive: true });
			await writeFile(join(stateDir, 'server-token'), 'state-token\n');
			const app = new OpenAPIHono();
			registerRootRoutes(app);

			const unauthorized = await app.request('/v1/server/info');
			expect(unauthorized.status).toBe(401);

			const authorized = await app.request('/v1/server/info', {
				headers: { Authorization: 'Bearer state-token' },
			});
			expect(authorized.status).toBe(200);
		});
	});
});
