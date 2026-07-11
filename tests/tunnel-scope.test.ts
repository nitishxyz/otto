import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from 'bun:test';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAPIHono } from '@hono/zod-openapi';
import * as sdkActual from '@ottocode/sdk';
import { registerTunnelRoutes } from '../packages/server/src/routes/tunnel.ts';
import { listTunnelShares } from '../packages/server/src/routes/tunnel/shares.ts';
import {
	setServerPort,
	setServerVersion,
} from '../packages/server/src/state.ts';

const realSdk = { ...sdkActual };

class MockTunnel extends EventEmitter {
	static starts: number[] = [];
	static managedStarts: Array<{ token: string; url: string }> = [];
	static stops = 0;
	static nextId = 0;
	isRunning = false;

	async start(port: number) {
		this.isRunning = true;
		MockTunnel.starts.push(port);
		return `https://mock-${++MockTunnel.nextId}.example.com`;
	}

	async startManaged(token: string, url: string) {
		this.isRunning = true;
		MockTunnel.managedStarts.push({ token, url });
		return url;
	}

	stop() {
		this.isRunning = false;
		MockTunnel.stops += 1;
		return true;
	}
}

mock.module('@ottocode/sdk', () => ({
	...realSdk,
	generateQRCode: async (url: string) => `qr:${url}`,
	isTunnelBinaryInstalled: async () => true,
	killStaleTunnels: async () => {},
	logger: { error: () => {} },
	loadConfig: async () => ({ projectRoot: '/tmp/project' }),
	openAuthUrl: async () => true,
	OttoTunnel: MockTunnel,
	printQRCode: async () => {},
}));

afterAll(() => {
	mock.module('@ottocode/sdk', () => realSdk);
});

type TunnelService =
	typeof import('../packages/server/src/routes/tunnel/service.ts');

let service: TunnelService;

async function startUpstream(
	handler: (req: Request) => Response | Promise<Response>,
): Promise<{ server: Server; port: number }> {
	const server = createServer(async (req, res) => {
		const request = new Request(`http://localhost${req.url ?? '/'}`, {
			method: req.method,
			headers: req.headers as HeadersInit,
			body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
			duplex:
				req.method === 'GET' || req.method === 'HEAD' ? undefined : 'half',
		} as RequestInit & { duplex?: 'half' });
		const response = await handler(request);
		res.writeHead(
			response.status,
			Object.fromEntries(response.headers.entries()),
		);
		if (response.body) {
			for await (const chunk of response.body) res.write(chunk);
		}
		res.end();
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return { server, port: (server.address() as AddressInfo).port };
}

beforeEach(async () => {
	service = await import('../packages/server/src/routes/tunnel/service.ts');
	service.tunnelTesting.reset();
	service.tunnelTesting.setManagedStateWriter(async () => {});
	MockTunnel.starts = [];
	MockTunnel.managedStarts = [];
	MockTunnel.stops = 0;
	MockTunnel.nextId = 0;
});

afterEach(() => {
	service.tunnelTesting.reset();
});

describe('managed tunnel service', () => {
	function configureManagedTunnel() {
		const provisions: Array<{ localPort: number; daemonVersion: string }> = [];
		setServerPort(47_477);
		setServerVersion('1.2.3');
		service.tunnelTesting.setManagedAuthProvider(async () => ({
			accessToken: 'oauth-token',
		}));
		service.tunnelTesting.setManagedProvisioner(async (_auth, options) => {
			provisions.push({
				localPort: options.localPort,
				daemonVersion: options.daemonVersion,
			});
			return {
				slug: 'device-slug',
				hostname: 'device.ottorouter.org',
				url: 'https://device.ottorouter.org',
				tunnel_token: 'cloudflare-secret',
			};
		});
		return provisions;
	}

	test('starts one managed daemon using the runtime port without quick fallback', async () => {
		const provisions = configureManagedTunnel();
		const [first, second] = await Promise.all([
			service.startTunnel(9999, { mode: 'managed' }),
			service.startTunnel(undefined, { mode: 'managed' }),
		]);

		expect(first).toMatchObject({
			ok: true,
			mode: 'managed',
			url: 'https://device.ottorouter.org',
		});
		expect(second).toMatchObject({ ok: true, mode: 'managed' });
		expect(provisions).toEqual([{ localPort: 47_477, daemonVersion: '1.2.3' }]);
		expect(MockTunnel.managedStarts).toEqual([
			{
				token: 'cloudflare-secret',
				url: 'https://device.ottorouter.org',
			},
		]);
		expect(MockTunnel.starts).toEqual([]);

		expect(await service.getTunnelStatus({ mode: 'managed' })).toMatchObject({
			mode: 'managed',
			hostname: 'device.ottorouter.org',
			ottorouterConnected: true,
			status: 'connected',
			isRunning: true,
		});
	});

	test('returns a typed auth error and never falls back to quick', async () => {
		setServerPort(47_477);
		service.tunnelTesting.setManagedAuthProvider(async () => null);

		expect(await service.startTunnel(undefined, { mode: 'managed' })).toEqual({
			ok: false,
			mode: 'managed',
			scope: 'remote-control',
			projectId: null,
			code: 'ottorouter_not_connected',
			error: 'Connect OttoRouter before starting a managed tunnel',
		});
		expect(MockTunnel.managedStarts).toEqual([]);
		expect(MockTunnel.starts).toEqual([]);
	});

	test('creates and revokes managed shares without additional tunnel processes', async () => {
		configureManagedTunnel();
		const first = await service.startTunnel(undefined, {
			mode: 'managed',
			scope: 'project-share',
			projectId: 'project-a',
		});
		const second = await service.startTunnel(undefined, {
			mode: 'managed',
			scope: 'project-share',
			projectId: 'project-b',
		});

		expect(first).toMatchObject({ ok: true, mode: 'managed' });
		expect(new URL(first.url ?? '').searchParams.get('share')).toBeTruthy();
		expect(second).toMatchObject({ ok: true, mode: 'managed' });
		expect(MockTunnel.managedStarts).toHaveLength(1);
		expect(listTunnelShares()).toHaveLength(2);

		expect(
			await service.stopTunnel({
				mode: 'managed',
				scope: 'project-share',
				projectId: 'project-a',
			}),
		).toMatchObject({ ok: true, message: 'Project share stopped' });
		expect(listTunnelShares()).toHaveLength(1);
		expect(await service.getTunnelStatus({ mode: 'managed' })).toMatchObject({
			status: 'connected',
			isRunning: true,
		});
	});

	test('accepts managed mode through route bodies and status queries', async () => {
		configureManagedTunnel();
		const app = new OpenAPIHono();
		registerTunnelRoutes(app);

		const startResponse = await app.request('/v1/tunnel/start', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mode: 'managed' }),
		});
		expect(startResponse.status).toBe(200);
		expect(await startResponse.json()).toMatchObject({
			ok: true,
			mode: 'managed',
		});

		const statusResponse = await app.request('/v1/tunnel/status?mode=managed');
		expect(statusResponse.status).toBe(200);
		expect(await statusResponse.json()).toMatchObject({
			mode: 'managed',
			hostname: 'device.ottorouter.org',
			ottorouterConnected: true,
		});
	});

	test('persists enabled after success and disabled after explicit stop', async () => {
		configureManagedTunnel();
		const desired: boolean[] = [];
		service.tunnelTesting.setManagedStateWriter(async (enabled) => {
			desired.push(enabled);
		});

		await service.startTunnel(undefined, { mode: 'managed' });
		await service.stopTunnel({ mode: 'managed' });
		expect(desired).toEqual([true, false]);
	});

	test('restores enabled managed tunnel and preserves stable provisioned hostname', async () => {
		const provisions = configureManagedTunnel();
		const desiredWrites: boolean[] = [];
		service.tunnelTesting.setManagedStateReader(async () => ({
			enabled: true,
		}));
		service.tunnelTesting.setManagedStateWriter(async (enabled) => {
			desiredWrites.push(enabled);
		});

		await service.restoreManagedTunnel();
		expect(provisions).toEqual([{ localPort: 47_477, daemonVersion: '1.2.3' }]);
		expect(await service.getTunnelStatus({ mode: 'managed' })).toMatchObject({
			status: 'connected',
			hostname: 'device.ottorouter.org',
			url: 'https://device.ottorouter.org',
		});
		expect(desiredWrites).toEqual([]);
	});

	test('does not restore disabled state or any quick tunnel', async () => {
		configureManagedTunnel();
		service.tunnelTesting.setManagedStateReader(async () => ({
			enabled: false,
		}));
		await service.restoreManagedTunnel();
		expect(MockTunnel.managedStarts).toEqual([]);
		expect(MockTunnel.starts).toEqual([]);
	});

	test('surfaces restore failure without changing enabled desired state', async () => {
		setServerPort(47_477);
		const desiredWrites: boolean[] = [];
		service.tunnelTesting.setManagedStateReader(async () => ({
			enabled: true,
		}));
		service.tunnelTesting.setManagedStateWriter(async (enabled) => {
			desiredWrites.push(enabled);
		});
		service.tunnelTesting.setManagedAuthProvider(async () => null);

		await service.restoreManagedTunnel();
		expect(await service.getTunnelStatus({ mode: 'managed' })).toMatchObject({
			status: 'error',
			error: 'Connect OttoRouter before starting a managed tunnel',
			isRunning: false,
		});
		expect(desiredWrites).toEqual([]);
	});

	test('shutdown stops managed process without persisting disabled state', async () => {
		configureManagedTunnel();
		const desiredWrites: boolean[] = [];
		service.tunnelTesting.setManagedStateWriter(async (enabled) => {
			desiredWrites.push(enabled);
		});
		await service.startTunnel(undefined, { mode: 'managed' });
		desiredWrites.length = 0;

		service.shutdownActiveTunnels();
		expect(MockTunnel.stops).toBe(1);
		expect(desiredWrites).toEqual([]);
	});
});

describe('tunnel scoped service', () => {
	test('starts, reports, and stops remote-control independently', async () => {
		const start = await service.startTunnel(9100, { scope: 'remote-control' });
		expect(start).toMatchObject({
			ok: true,
			scope: 'remote-control',
			projectId: null,
			url: 'https://mock-1.example.com',
		});

		const status = await service.getTunnelStatus({ scope: 'remote-control' });
		expect(status).toMatchObject({
			scope: 'remote-control',
			projectId: null,
			status: 'connected',
			url: 'https://mock-1.example.com',
			isRunning: true,
		});

		const stop = await service.stopTunnel({ scope: 'remote-control' });
		expect(stop).toMatchObject({
			ok: true,
			scope: 'remote-control',
			projectId: null,
		});
		expect(
			await service.getTunnelStatus({ scope: 'remote-control' }),
		).toMatchObject({
			status: 'idle',
			url: null,
			isRunning: false,
		});
	});

	test('keeps remote-control running when a project-share starts and stops', async () => {
		await service.startTunnel(9100, { scope: 'remote-control' });
		const share = await service.startTunnel(9100, {
			scope: 'project-share',
			projectId: 'project-a',
		});

		expect(share).toMatchObject({
			ok: true,
			scope: 'project-share',
			projectId: 'project-a',
			url: 'https://mock-2.example.com',
		});
		expect(MockTunnel.starts).toHaveLength(2);

		await service.stopTunnel({
			scope: 'project-share',
			projectId: 'project-a',
		});
		expect(
			await service.getTunnelStatus({ scope: 'remote-control' }),
		).toMatchObject({
			status: 'connected',
			url: 'https://mock-1.example.com',
			isRunning: true,
		});
		expect(
			await service.getTunnelStatus({
				scope: 'project-share',
				projectId: 'project-a',
			}),
		).toMatchObject({
			projectId: 'project-a',
			status: 'idle',
			url: null,
		});
	});

	test('requires and reports projectId metadata for project-share', async () => {
		expect(await service.startTunnel(9100, { scope: 'project-share' })).toEqual(
			{
				ok: false,
				error: 'projectId is required for project-share tunnel',
			},
		);

		await service.startTunnel(9100, {
			scope: 'project-share',
			projectId: 'project-a',
		});
		expect(
			await service.getTunnelStatus({
				scope: 'project-share',
				projectId: 'project-a',
			}),
		).toMatchObject({
			scope: 'project-share',
			projectId: 'project-a',
			status: 'connected',
		});
	});

	test('project-share proxy blocks global routes and forces selected projectId', async () => {
		let observedUrl: string | null = null;
		let observedProjectId: string | null = null;
		const upstream = await startUpstream((req) => {
			observedUrl = req.url;
			observedProjectId = req.headers.get('x-otto-project-id');
			return Response.json({ ok: true });
		});

		try {
			await service.startTunnel(upstream.port, {
				scope: 'project-share',
				projectId: 'project-a',
			});
			const proxyPort = MockTunnel.starts.at(-1);
			expect(proxyPort).toBeNumber();

			const blocked = await fetch(`http://127.0.0.1:${proxyPort}/v1/projects`);
			expect(blocked.status).toBe(403);

			const forced = await fetch(
				`http://127.0.0.1:${proxyPort}/v1/sessions?projectId=project-b&project=/tmp/other`,
				{
					headers: {
						'X-Otto-Project-Id': 'project-b',
						'X-Otto-Project': '/tmp/other',
					},
				},
			);
			expect(forced.status).toBe(200);
			expect(observedUrl).toContain('/v1/sessions?projectId=project-a');
			expect(observedUrl).not.toContain('project-b');
			expect(observedUrl).not.toContain('project=%2Ftmp%2Fother');
			expect(observedProjectId).toBe('project-a');
		} finally {
			upstream.server.close();
		}
	});
});
