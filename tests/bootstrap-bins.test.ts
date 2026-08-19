import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapBinary } from '../apps/cli/src/bootstrap-bins.ts';

const testDir = join(tmpdir(), `otto-bootstrap-bins-${process.pid}`);

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true });
});

describe('binary bootstrap', () => {
	test('builds distributable Whisper binaries without host CPU tuning', async () => {
		const script = await Bun.file(
			join(import.meta.dir, '..', 'scripts', 'download-vendor-bins.sh'),
		).text();

		expect(script).toContain('local cpu_args=(-DGGML_NATIVE=OFF)');
		expect(script).toContain('cpu_args+=(-DGGML_CPU_ARM_ARCH=armv8-a)');
	});

	test('replaces a managed binary when its revision changes', async () => {
		await mkdir(testDir, { recursive: true });
		const source = join(testDir, 'source');
		const destination = join(testDir, 'bin', 'whisper-cli');
		const sourceBytes = Buffer.alloc(100_001, 1);
		await writeFile(source, sourceBytes);
		await mkdir(join(testDir, 'bin'));
		await writeFile(destination, Buffer.alloc(100_001, 2));

		bootstrapBinary(source, destination, { revision: 'portable-1' });

		expect(await readFile(destination)).toEqual(sourceBytes);
		expect(await readFile(`${destination}.revision`, 'utf8')).toBe(
			'portable-1\n',
		);
	});

	test('preserves a managed binary at the current revision', async () => {
		await mkdir(testDir, { recursive: true });
		const source = join(testDir, 'source');
		const destination = join(testDir, 'bin', 'whisper-cli');
		const existingBytes = Buffer.alloc(100_001, 2);
		await writeFile(source, Buffer.alloc(100_001, 1));
		await mkdir(join(testDir, 'bin'));
		await writeFile(destination, existingBytes);
		await writeFile(`${destination}.revision`, 'portable-1\n');

		bootstrapBinary(source, destination, { revision: 'portable-1' });

		expect(await readFile(destination)).toEqual(existingBytes);
	});
});
