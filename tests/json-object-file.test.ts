import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	atomicWriteJsonObject,
	readOptionalJsonObject,
} from '../packages/sdk/src/runtime/json-object-file.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'otto-json-object-'));
	temporaryDirectories.push(directory);
	return directory;
}

describe('JSON object files', () => {
	test('returns undefined for missing, malformed, and non-object JSON', async () => {
		const directory = await temporaryDirectory();
		const filePath = join(directory, 'config.json');
		expect(await readOptionalJsonObject(filePath)).toBeUndefined();

		await writeFile(filePath, '{broken');
		expect(await readOptionalJsonObject(filePath)).toBeUndefined();

		await writeFile(filePath, '[]');
		expect(await readOptionalJsonObject(filePath)).toBeUndefined();

		await writeFile(filePath, '{"enabled":true}');
		expect(await readOptionalJsonObject(filePath)).toEqual({ enabled: true });
	});

	test('atomically writes JSON and applies auth permissions', async () => {
		const directory = await temporaryDirectory();
		const filePath = join(directory, 'nested', 'auth.json');
		await atomicWriteJsonObject(filePath, { token: 'secret' }, { mode: 0o600 });

		expect(await readOptionalJsonObject(filePath)).toEqual({ token: 'secret' });
		expect((await stat(filePath)).mode & 0o777).toBe(0o600);
		expect(await readdir(join(directory, 'nested'))).toEqual(['auth.json']);
	});

	test('cleans up the temporary file when rename fails', async () => {
		const directory = await temporaryDirectory();
		const filePath = join(directory, 'config.json');
		await expect(
			atomicWriteJsonObject(
				filePath,
				{ value: 1 },
				{
					operations: {
						rename: async () => {
							throw new Error('rename failed');
						},
					},
				},
			),
		).rejects.toThrow('rename failed');
		expect(await readdir(directory)).toEqual([]);
	});
});
