import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	readManagedTunnelDesiredState,
	writeManagedTunnelDesiredState,
} from '../packages/server/src/routes/tunnel/managed-state.ts';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe('managed tunnel desired state', () => {
	test('defaults invalid or missing state to disabled', async () => {
		const root = await mkdtemp(join(tmpdir(), 'otto-managed-state-'));
		roots.push(root);
		expect(
			await readManagedTunnelDesiredState(join(root, 'missing.json')),
		).toEqual({
			enabled: false,
		});
		await Bun.write(join(root, 'invalid.json'), '{bad');
		expect(
			await readManagedTunnelDesiredState(join(root, 'invalid.json')),
		).toEqual({
			enabled: false,
		});
	});

	test('atomically persists only enabled state with private permissions', async () => {
		const root = await mkdtemp(join(tmpdir(), 'otto-managed-state-'));
		roots.push(root);
		const path = join(root, 'nested', 'managed-tunnel.json');
		await writeManagedTunnelDesiredState(true, path);

		expect(await readManagedTunnelDesiredState(path)).toEqual({
			enabled: true,
		});
		expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ enabled: true });
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect((await stat(join(root, 'nested'))).mode & 0o777).toBe(0o700);
	});
});
