import { afterEach, describe, expect, test } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
	getManagedTunnelDeviceId,
	provisionManagedTunnel,
} from '../packages/sdk/src/tunnel/managed.ts';
import { OttoTunnel } from '../packages/sdk/src/tunnel/tunnel.ts';

const temporaryDirectories: string[] = [];

async function temporaryOttoHome(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'otto-managed-tunnel-'));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe('managed tunnel identity', () => {
	test('persists and reuses a generated device UUID', async () => {
		const ottoHome = await temporaryOttoHome();
		const first = await getManagedTunnelDeviceId(ottoHome);
		const second = await getManagedTunnelDeviceId(ottoHome);

		expect(second).toBe(first);
		expect((await readFile(join(ottoHome, 'device-id'), 'utf8')).trim()).toBe(
			first,
		);
		expect(first).toMatch(/^[0-9a-f-]{36}$/);
	});

	test('replaces an invalid stored identity', async () => {
		const ottoHome = await temporaryOttoHome();
		await writeFile(join(ottoHome, 'device-id'), 'invalid\n');

		const deviceId = await getManagedTunnelDeviceId(ottoHome);

		expect(deviceId).not.toBe('invalid');
		expect((await readFile(join(ottoHome, 'device-id'), 'utf8')).trim()).toBe(
			deviceId,
		);
	});
});

test('provisionManagedTunnel sends runtime metadata and parses the deployed response', async () => {
	const ottoHome = await temporaryOttoHome();
	let request: Request | undefined;
	const fetcher: typeof fetch = async (input, init) => {
		request = new Request(input, init);
		return Response.json({
			device: {
				id: 'record-id',
				device_id: 'device-id',
				slug: 'stable123',
				name: null,
			},
			hostname: 'stable123.ottorouter.org',
			url: 'https://stable123.ottorouter.org',
			tunnel_token: 'secret-tunnel-token',
		});
	};

	const result = await provisionManagedTunnel(
		{ accessToken: 'oauth-access-token' },
		{
			baseUrl: 'https://setu.example/',
			daemonVersion: '1.2.3',
			fetch: fetcher,
			localPort: 47_477,
			ottoHome,
		},
	);

	expect(request?.url).toBe('https://setu.example/v1/tunnels/device');
	expect(request?.headers.get('authorization')).toBe(
		'Bearer oauth-access-token',
	);
	expect(await request?.json()).toEqual({
		device_id: await getManagedTunnelDeviceId(ottoHome),
		daemon_version: '1.2.3',
		local_port: 47_477,
	});
	expect(result).toEqual({
		slug: 'stable123',
		hostname: 'stable123.ottorouter.org',
		url: 'https://stable123.ottorouter.org',
		tunnel_token: 'secret-tunnel-token',
	});
});

function fakeTunnelProcess(output: string): ChildProcess {
	const child = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = () => true;
	queueMicrotask(() => child.stderr?.emit('data', Buffer.from(output)));
	return child as ChildProcess;
}

describe('OttoTunnel managed startup', () => {
	test('uses named tunnel arguments and waits for a registered connection', async () => {
		let spawnedArgs: readonly string[] = [];
		const tunnel = new OttoTunnel({
			ensureBinary: async () => '/tmp/tunnel',
			spawn: ((_binary: string, args: readonly string[]) => {
				spawnedArgs = args;
				return fakeTunnelProcess(
					'Registered tunnel connection connIndex=0 connection=abcdef12-3456 ip=198.51.100.2 location=sjc01',
				);
			}) as typeof import('node:child_process').spawn,
		});

		const url = await tunnel.startManaged(
			'secret-tunnel-token',
			'https://stable123.ottorouter.org',
		);

		expect(spawnedArgs).toEqual([
			'tunnel',
			'run',
			'--token',
			'secret-tunnel-token',
		]);
		expect(url).toBe('https://stable123.ottorouter.org');
	});

	test('preserves quick tunnel URL readiness', async () => {
		const tunnel = new OttoTunnel({
			ensureBinary: async () => '/tmp/tunnel',
			spawn: (() =>
				fakeTunnelProcess(
					'Your quick Tunnel has been created! Visit https://temporary.trycloudflare.com',
				)) as typeof import('node:child_process').spawn,
		});

		expect(await tunnel.start(47_477)).toBe(
			'https://temporary.trycloudflare.com',
		);
	});
});
