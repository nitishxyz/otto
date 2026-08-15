import { afterEach, describe, expect, test } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
	getManagedTunnelDeviceId,
	getManagedTunnelMachineId,
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

	test('migrates the historical machine UUID into machine-global storage', async () => {
		const legacyHome = await temporaryOttoHome();
		const machineHome = await temporaryOttoHome();
		const existing = crypto.randomUUID();
		await writeFile(join(legacyHome, 'machine-id'), `${existing}\n`);

		const first = await getManagedTunnelMachineId(machineHome, legacyHome);
		await rm(legacyHome, { recursive: true, force: true });
		const second = await getManagedTunnelMachineId(machineHome, legacyHome);

		expect(first).toBe(existing);
		expect(second).toBe(existing);
		expect(
			(await readFile(join(machineHome, 'machine-id'), 'utf8')).trim(),
		).toBe(existing);
	});

	test('persists a distinct stable machine connector UUID', async () => {
		const ottoHome = await temporaryOttoHome();
		const deviceId = await getManagedTunnelDeviceId(ottoHome);
		const first = await getManagedTunnelMachineId(ottoHome);
		const second = await getManagedTunnelMachineId(ottoHome);

		expect(second).toBe(first);
		expect(first).not.toBe(deviceId);
		expect((await readFile(join(ottoHome, 'machine-id'), 'utf8')).trim()).toBe(
			first,
		);
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
		machine_id: await getManagedTunnelMachineId(ottoHome),
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

test('provisionManagedTunnel preserves an unauthorized response status', async () => {
	const ottoHome = await temporaryOttoHome();

	await expect(
		provisionManagedTunnel(
			{ accessToken: 'rejected-token' },
			{
				baseUrl: 'https://setu.example/',
				daemonVersion: '1.2.3',
				fetch: async () =>
					Response.json({ error: 'unauthorized' }, { status: 401 }),
				localPort: 47_477,
				ottoHome,
			},
		),
	).rejects.toMatchObject({
		name: 'ManagedTunnelProvisionError',
		status: 401,
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

	test('accepts fragmented registration output with an IPv6 edge address', async () => {
		const tunnel = new OttoTunnel({
			ensureBinary: async () => '/tmp/tunnel',
			spawn: (() => {
				const child = fakeTunnelProcess(
					'Registered tunnel connection connIndex=0 connection=abcdef12',
				);
				queueMicrotask(() =>
					child.stderr?.emit(
						'data',
						Buffer.from(' ip=2606:4700:a0::1 location=fra06'),
					),
				);
				return child;
			}) as typeof import('node:child_process').spawn,
		});

		expect(
			await tunnel.startManaged(
				'secret-tunnel-token',
				'https://stable123.ottorouter.org',
			),
		).toBe('https://stable123.ottorouter.org');
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

	test('emits disconnects from cloudflared unregistration output', async () => {
		let child: ChildProcess | undefined;
		const tunnel = new OttoTunnel({
			ensureBinary: async () => '/tmp/tunnel',
			spawn: (() => {
				child = fakeTunnelProcess(
					'Registered tunnel connection connIndex=0 connection=abcdef12 ip=198.51.100.2 location=sjc01\n',
				);
				return child;
			}) as typeof import('node:child_process').spawn,
		});
		await tunnel.startManaged(
			'secret-tunnel-token',
			'https://stable123.ottorouter.org',
		);
		const disconnected = new Promise((resolve) =>
			tunnel.once('disconnected', resolve),
		);
		child?.stderr?.emit(
			'data',
			Buffer.from('Unregistered tunnel connection connIndex=0'),
		);

		expect(await disconnected).toMatchObject({ id: 'abcdef12' });
	});

	test('force kills a child that does not exit after SIGINT', async () => {
		const signals: Array<NodeJS.Signals | number | undefined> = [];
		const tunnel = new OttoTunnel({
			ensureBinary: async () => '/tmp/tunnel',
			forceKillDelayMs: 0,
			spawn: (() => {
				const child = fakeTunnelProcess(
					'Registered tunnel connection connIndex=0 connection=abcdef12',
				);
				child.kill = (signal) => {
					signals.push(signal);
					Object.defineProperty(child, 'killed', { value: true });
					return true;
				};
				return child;
			}) as typeof import('node:child_process').spawn,
		});
		await tunnel.startManaged(
			'secret-tunnel-token',
			'https://stable123.ottorouter.org',
		);

		tunnel.stop();
		await Bun.sleep(10);

		expect(signals).toEqual(['SIGINT', 'SIGKILL']);
	});
});
