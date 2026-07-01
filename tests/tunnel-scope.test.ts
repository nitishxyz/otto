import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

class MockTunnel extends EventEmitter {
	static starts: number[] = [];
	static stops = 0;
	static nextId = 0;
	isRunning = false;

	async start(port: number) {
		this.isRunning = true;
		MockTunnel.starts.push(port);
		return `https://mock-${++MockTunnel.nextId}.example.com`;
	}

	stop() {
		this.isRunning = false;
		MockTunnel.stops += 1;
		return true;
	}
}

mock.module('@ottocode/sdk', () => ({
	generateQRCode: async (url: string) => `qr:${url}`,
	isTunnelBinaryInstalled: async () => true,
	killStaleTunnels: async () => {},
	logger: { error: () => {} },
	loadConfig: async () => ({ projectRoot: '/tmp/project' }),
	openAuthUrl: async () => true,
	OttoTunnel: MockTunnel,
	printQRCode: async () => {},
}));

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
	MockTunnel.starts = [];
	MockTunnel.stops = 0;
	MockTunnel.nextId = 0;
});

afterEach(() => {
	service.tunnelTesting.reset();
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

		const stop = service.stopTunnel({ scope: 'remote-control' });
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

		service.stopTunnel({ scope: 'project-share', projectId: 'project-a' });
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
