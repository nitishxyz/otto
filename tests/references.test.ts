import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { loadConfig } from '@ottocode/sdk';
import {
	getReferenceStatuses,
	prepareReferences,
	resolveReferences,
	retryReferencePreparation,
} from '../packages/server/src/runtime/context/references';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe('references', () => {
	it('resolves project-relative local directories and skips disabled entries', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-references-'));
		roots.push(projectRoot);
		const referencePath = join(projectRoot, 'docs-source');
		await mkdir(referencePath);
		const cfg = await loadConfig(projectRoot);
		cfg.references = {
			docs: {
				description: 'Use for documentation conventions',
				source: { type: 'local', path: './docs-source' },
			},
			disabled: {
				description: 'Do not expose this',
				enabled: false,
				source: { type: 'local', path: './docs-source' },
			},
		};

		const references = await resolveReferences(cfg);

		expect(references).toEqual([
			{
				name: 'docs',
				description: 'Use for documentation conventions',
				path: referencePath,
				status: 'available',
			},
		]);
	});

	it('omits unavailable references from agent context', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-references-'));
		roots.push(projectRoot);
		const cfg = await loadConfig(projectRoot);
		cfg.references = {
			missing: {
				description: 'Optional external source',
				source: { type: 'local', path: './missing' },
			},
		};

		const references = await resolveReferences(cfg);

		expect(references).toEqual([]);
		const statuses = await getReferenceStatuses(cfg);
		expect(statuses.missing?.status).toBe('error');
		expect(statuses.missing?.error).toBeTruthy();
	});

	it('clones Git references in the background instead of during resolution', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-references-'));
		roots.push(projectRoot);
		const sourcePath = join(projectRoot, 'source');
		const cacheDir = join(projectRoot, 'cache');
		await mkdir(sourcePath);
		await writeFile(join(sourcePath, 'README.md'), '# Reference');
		runGit(sourcePath, ['init']);
		runGit(sourcePath, ['add', 'README.md']);
		runGit(sourcePath, [
			'-c',
			'user.name=Otto Tests',
			'-c',
			'user.email=otto@example.com',
			'commit',
			'-m',
			'Initial commit',
		]);
		const cfg = await loadConfig(projectRoot);
		cfg.references = {
			docs: {
				description: 'Use for documentation conventions',
				source: { type: 'git', url: sourcePath },
			},
		};
		const testConfig = { ...cfg, paths: { ...cfg.paths, cacheDir } };

		const beforePreparation = await resolveReferences(testConfig);

		expect(beforePreparation).toEqual([]);
		prepareReferences(testConfig);
		let status = (await getReferenceStatuses(testConfig)).docs;
		for (
			let attempt = 0;
			status?.status === 'cloning' && attempt < 100;
			attempt++
		) {
			await Bun.sleep(10);
			status = (await getReferenceStatuses(testConfig)).docs;
		}
		expect(status).toEqual({ status: 'available' });
		const [reference] = await resolveReferences(testConfig);
		expect(reference?.status).toBe('available');
		expect(reference?.path).toContain(cacheDir);
	});

	it('keeps failed clones idle until explicitly retried', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-references-'));
		roots.push(projectRoot);
		const sourcePath = join(projectRoot, 'source');
		const cacheDir = join(projectRoot, 'cache');
		const cfg = await loadConfig(projectRoot);
		const reference = {
			description: 'Use for documentation conventions',
			source: { type: 'git' as const, url: sourcePath },
		};
		cfg.references = { docs: reference };
		const testConfig = { ...cfg, paths: { ...cfg.paths, cacheDir } };

		prepareReferences(testConfig);
		expect((await waitForStatus(testConfig, 'error')).error).toBeTruthy();
		await createGitRepository(sourcePath);

		prepareReferences(testConfig);
		await Bun.sleep(20);
		expect((await getReferenceStatuses(testConfig)).docs?.status).toBe('error');

		retryReferencePreparation('docs', reference, testConfig);
		expect(await waitForStatus(testConfig, 'available')).toEqual({
			status: 'available',
		});
	});
});

async function createGitRepository(path: string): Promise<void> {
	await mkdir(path);
	await writeFile(join(path, 'README.md'), '# Reference');
	runGit(path, ['init']);
	runGit(path, ['add', 'README.md']);
	runGit(path, [
		'-c',
		'user.name=Otto Tests',
		'-c',
		'user.email=otto@example.com',
		'commit',
		'-m',
		'Initial commit',
	]);
}

async function waitForStatus(
	cfg: Awaited<ReturnType<typeof loadConfig>>,
	expected: 'available' | 'error',
) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const status = (await getReferenceStatuses(cfg)).docs;
		if (status?.status === expected) return status;
		await Bun.sleep(10);
	}
	throw new Error(`Timed out waiting for reference status ${expected}`);
}

function runGit(cwd: string, args: string[]): void {
	const result = Bun.spawnSync(['git', ...args], { cwd, stderr: 'pipe' });
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString());
	}
}
