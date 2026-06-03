import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ensureProjectOttoIgnored } from '@ottocode/cli/src/gitignore.ts';

const execFileAsync = promisify(execFile);

describe('gitignore helper', () => {
	let projectDir: string;

	beforeEach(async () => {
		projectDir = await mkdtemp(join(tmpdir(), 'otto-gitignore-'));
	});

	afterEach(async () => {
		await rm(projectDir, { recursive: true, force: true });
	});

	test('does nothing outside a git repository', async () => {
		const changed = await ensureProjectOttoIgnored(projectDir);

		expect(changed).toBe(false);
		expect(existsSync(join(projectDir, '.gitignore'))).toBe(false);
	});

	test('adds .otto to a git repository without a gitignore', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });

		const changed = await ensureProjectOttoIgnored(projectDir);

		expect(changed).toBe(true);
		expect(await readFile(join(projectDir, '.gitignore'), 'utf8')).toBe(
			'.otto\n',
		);
	});

	test('appends .otto to an existing gitignore once', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });
		await writeFile(join(projectDir, '.gitignore'), 'dist\nnode_modules\n');

		const firstChanged = await ensureProjectOttoIgnored(projectDir);
		const secondChanged = await ensureProjectOttoIgnored(projectDir);

		expect(firstChanged).toBe(true);
		expect(secondChanged).toBe(false);
		expect(await readFile(join(projectDir, '.gitignore'), 'utf8')).toBe(
			'dist\nnode_modules\n.otto\n',
		);
	});

	test('recognizes existing .otto ignore variants', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });
		await writeFile(join(projectDir, '.gitignore'), 'dist\n/.otto/\n');

		const changed = await ensureProjectOttoIgnored(projectDir);

		expect(changed).toBe(false);
		expect(await readFile(join(projectDir, '.gitignore'), 'utf8')).toBe(
			'dist\n/.otto/\n',
		);
	});

	test('updates the repository root gitignore from a subdirectory', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });
		const subdir = join(projectDir, 'packages', 'app');
		await mkdir(subdir, { recursive: true });

		const changed = await ensureProjectOttoIgnored(subdir);

		expect(changed).toBe(true);
		expect(await readFile(join(projectDir, '.gitignore'), 'utf8')).toBe(
			'.otto\n',
		);
	});
});
