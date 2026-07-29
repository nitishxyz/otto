import { OpenAPIHono } from '@hono/zod-openapi';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTunnelRoutes } from '../packages/server/src/routes/tunnel.ts';
import {
	registerExternalTunnel,
	tunnelTesting,
} from '../packages/server/src/routes/tunnel/service.ts';
import {
	clearTunnelShares,
	createTunnelShare,
	revokeTunnelShare,
} from '../packages/server/src/routes/tunnel/shares.ts';
import {
	DAEMON_TOKEN_COOKIE,
	ensureDaemonToken,
	tunnelAuthMiddleware,
} from '../packages/server/src/tunnel-auth.ts';

const tempRoots: string[] = [];
const originalOttoHome = process.env.OTTO_HOME;

async function useTempOttoHome(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'otto-tunnel-auth-test-'));
	tempRoots.push(root);
	process.env.OTTO_HOME = root;
	return root;
}

function createAuthTestApp() {
	const app = new OpenAPIHono();
	app.use('*', tunnelAuthMiddleware);
	app.get('/v1/data', (c) =>
		c.json({
			projectId: c.req.header('x-otto-project-id') ?? null,
			pinnedProjectId: c.req.header('x-otto-share-project-id') ?? null,
			projectPath: c.req.header('x-otto-project') ?? null,
		}),
	);
	app.get('/assets/app.js', (c) => c.text('static asset'));
	app.get('/v1/attachments/:id', (c) =>
		c.json({ projectId: c.req.header('x-otto-project-id') ?? null }),
	);
	return app;
}

afterEach(async () => {
	clearTunnelShares();
	tunnelTesting.reset();
	if (originalOttoHome === undefined) {
		delete process.env.OTTO_HOME;
	} else {
		process.env.OTTO_HOME = originalOttoHome;
	}
	for (const root of tempRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe('tunnel auth middleware', () => {
	it('bypasses auth for localhost requests', async () => {
		await useTempOttoHome();
		const response = await createAuthTestApp().request(
			'http://localhost/v1/data',
		);
		expect(response.status).toBe(200);
	});

	it('requires tunnel auth for attachment bytes', async () => {
		await useTempOttoHome();
		const app = new OpenAPIHono();
		app.use('*', tunnelAuthMiddleware);
		app.get('/v1/attachments/:id', (c) => c.body('image'));
		const denied = await app.request(
			'https://device.example/v1/attachments/att_1',
		);
		expect(denied.status).toBe(401);
	});

	it('rejects unauthenticated tunnel APIs while allowing static UI assets', async () => {
		await useTempOttoHome();
		const app = createAuthTestApp();
		const apiResponse = await app.request('https://device.example/v1/data');
		const staticResponse = await app.request(
			'https://device.example/assets/app.js',
		);

		expect(apiResponse.status).toBe(401);
		expect(await apiResponse.json()).toEqual({ error: 'Unauthorized' });
		expect(staticResponse.status).toBe(200);
		expect(await staticResponse.text()).toBe('static asset');
	});

	it('allows only the public tunnel ping route without credentials', async () => {
		await useTempOttoHome();
		const app = new OpenAPIHono();
		app.use('*', tunnelAuthMiddleware);
		registerTunnelRoutes(app);

		const ping = await app.request('https://device.example/v1/tunnel/ping');
		const status = await app.request('https://device.example/v1/tunnel/status');

		expect(ping.status).toBe(200);
		expect(await ping.json()).toEqual({ status: 'ok' });
		expect(status.status).toBe(401);
	});

	it('generates and reuses a stable daemon token for headers and cookies', async () => {
		const root = await useTempOttoHome();
		const tokenPath = join(root, 'server-token');
		const token = await ensureDaemonToken(tokenPath);
		expect(token.length).toBeGreaterThanOrEqual(43);
		expect(await ensureDaemonToken(tokenPath)).toBe(token);

		const app = createAuthTestApp();
		const headerResponse = await app.request('https://device.example/v1/data', {
			headers: { Authorization: `Bearer ${token}` },
		});
		const cookieResponse = await app.request('https://device.example/v1/data', {
			headers: { Cookie: `${DAEMON_TOKEN_COOKIE}=${token}` },
		});
		expect(headerResponse.status).toBe(200);
		expect(cookieResponse.status).toBe(200);
	});

	it('allows attachment bytes only for valid owner/share credentials and pins shares', async () => {
		const root = await useTempOttoHome();
		const ownerToken = await ensureDaemonToken(join(root, 'server-token'));
		const share = createTunnelShare('project-pinned', 'https://device.example');
		const app = createAuthTestApp();

		const owner = await app.request(
			'https://device.example/v1/attachments/att_1',
			{ headers: { Authorization: `Bearer ${ownerToken}` } },
		);
		expect(owner.status).toBe(200);

		const shared = await app.request(
			'https://device.example/v1/attachments/att_1?projectId=attacker',
			{ headers: { 'X-Otto-Share-Token': share.token } },
		);
		expect(shared.status).toBe(200);
		expect(await shared.json()).toEqual({ projectId: 'project-pinned' });

		const wrong = await app.request(
			'https://device.example/v1/attachments/att_1',
			{ headers: { 'X-Otto-Share-Token': 'wrong' } },
		);
		expect(wrong.status).toBe(401);
		revokeTunnelShare(share.id);
		const revoked = await app.request(
			'https://device.example/v1/attachments/att_1',
			{ headers: { 'X-Otto-Share-Token': share.token } },
		);
		expect(revoked.status).toBe(401);
	});

	it('pins share requests and blocks daemon-global routes', async () => {
		await useTempOttoHome();
		const share = createTunnelShare('project-pinned', 'https://device.example');
		const app = createAuthTestApp();
		const response = await app.request(
			'https://device.example/v1/data?projectId=project-attacker',
			{
				headers: {
					Authorization: `Bearer ${share.token}`,
					'X-Otto-Project': '/tmp/attacker',
				},
			},
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			projectId: 'project-pinned',
			pinnedProjectId: 'project-pinned',
			projectPath: null,
		});

		for (const path of [
			'/v1/projects',
			'/v1/projects/directories',
			'/v1/projects/other',
			'/v1/tunnel/status',
			'/v1/browser/commands?tabId=browser%3Abrowser',
			'/v1/browser/commands/test/result',
		]) {
			const blocked = await app.request(`https://device.example${path}`, {
				headers: { Authorization: `Bearer ${share.token}` },
			});
			expect(blocked.status).toBe(403);
		}
	});
});

describe('tunnel share routes', () => {
	it('creates, lists, and revokes in-memory shares', async () => {
		registerExternalTunnel('https://device.example');
		const app = new OpenAPIHono();
		registerTunnelRoutes(app);

		const createResponse = await app.request('/v1/tunnel/shares', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ projectId: 'project-1' }),
		});
		expect(createResponse.status).toBe(200);
		const created = (await createResponse.json()) as {
			id: string;
			projectId: string;
			token: string;
			url: string;
		};
		expect(created.projectId).toBe('project-1');
		expect(created.token.length).toBeGreaterThanOrEqual(43);
		const shareUrl = new URL(created.url);
		expect(shareUrl.pathname).toBe('/sessions');
		expect(shareUrl.searchParams.get('share')).toBe(created.token);

		const listResponse = await app.request('/v1/tunnel/shares');
		expect(listResponse.status).toBe(200);
		expect((await listResponse.json()).shares).toHaveLength(1);

		const deleteResponse = await app.request(
			`/v1/tunnel/shares/${created.id}`,
			{ method: 'DELETE' },
		);
		expect(deleteResponse.status).toBe(200);
		expect(
			(await (await app.request('/v1/tunnel/shares')).json()).shares,
		).toEqual([]);
	});

	it('requires an active public tunnel URL before creating a share', async () => {
		const app = new OpenAPIHono();
		registerTunnelRoutes(app);
		const response = await app.request('/v1/tunnel/shares', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ projectId: 'project-1' }),
		});
		expect(response.status).toBe(409);
	});
});
