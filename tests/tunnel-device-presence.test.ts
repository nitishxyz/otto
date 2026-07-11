import { describe, expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createMachineAccountStore } from '../apps/desktop/src/lib/machine-account-store.ts';
import type { MachineDeviceState } from '../apps/desktop/src/lib/machine-api.ts';
import {
	classifyProbeStatus,
	probeDevice,
} from '../packages/server/src/routes/ottorouter/devices.ts';
import { registerTunnelRoutes } from '../packages/server/src/routes/tunnel.ts';
import { tunnelAuthMiddleware } from '../packages/server/src/tunnel-auth.ts';

describe('tunnel device presence', () => {
	test('probes exact public ping path with cache busting and classifies 530 then 200', async () => {
		const statuses = [530, 200];
		const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
		const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
			requests.push({ url: new URL(String(input)), init });
			return new Response('{}', { status: statuses.shift() });
		}) as typeof fetch;

		expect(await probeDevice('machine.ottorouter.org', fetcher)).toBe(
			'offline',
		);
		expect(await probeDevice('https://machine.ottorouter.org/', fetcher)).toBe(
			'online',
		);
		for (const request of requests) {
			expect(request.url.pathname).toBe('/v1/tunnel/ping');
			expect(request.url.searchParams.has('_')).toBe(true);
			expect(request.init?.cache).toBe('no-store');
			expect(request.init?.redirect).toBe('follow');
			expect(new Headers(request.init?.headers).get('cache-control')).toContain(
				'no-store',
			);
		}
		expect(classifyProbeStatus(401)).toBe('online');
		expect(classifyProbeStatus(530)).toBe('offline');
	});

	test('shared UI store transitions Offline to Online on refresh', async () => {
		const states: MachineDeviceState[] = [
			{
				configured: true,
				devices: [{ deviceId: 'remote', status: 'offline' }],
			},
			{
				configured: true,
				devices: [{ deviceId: 'remote', status: 'online' }],
			},
		];
		const store = createMachineAccountStore(
			async () => states.shift() ?? states[0],
		);
		await store.refresh();
		expect(store.getSnapshot().state?.devices[0]?.status).toBe('offline');
		await store.refresh();
		expect(store.getSnapshot().state?.devices[0]?.status).toBe('online');
	});

	test('ping exemption is exact GET and response prevents caching', async () => {
		const app = new OpenAPIHono();
		app.use('*', tunnelAuthMiddleware);
		registerTunnelRoutes(app);
		const response = await app.request(
			'https://machine.ottorouter.org/v1/tunnel/ping?_=123',
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toContain('no-store');
		const post = await app.request(
			'https://machine.ottorouter.org/v1/tunnel/ping',
			{ method: 'POST' },
		);
		expect(post.status).toBe(401);
	});
});
