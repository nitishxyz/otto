import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { loadConfig } from '@ottocode/sdk';
import { resolveReferences } from '../packages/server/src/runtime/context/references';

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

	it('reports invalid local references without failing the whole resolution', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-references-'));
		roots.push(projectRoot);
		const cfg = await loadConfig(projectRoot);
		cfg.references = {
			missing: {
				description: 'Optional external source',
				source: { type: 'local', path: './missing' },
			},
		};

		const [reference] = await resolveReferences(cfg);

		expect(reference?.name).toBe('missing');
		expect(reference?.status).toBe('unavailable');
		expect(reference?.path).toBeUndefined();
		expect(reference?.error).toBeTruthy();
	});
});
