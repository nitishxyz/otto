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

	test('does not create gitignore entries in a clean git repository', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });

		const changed = await ensureProjectOttoIgnored(projectDir);

		expect(changed).toBe(false);
		expect(existsSync(join(projectDir, '.gitignore'))).toBe(false);
		expect(existsSync(join(projectDir, '.otto', '.gitignore'))).toBe(false);
	});

	test('keeps unrelated root gitignore unchanged', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });
		await writeFile(join(projectDir, '.gitignore'), 'dist\nnode_modules\n');

		const firstChanged = await ensureProjectOttoIgnored(projectDir);
		const secondChanged = await ensureProjectOttoIgnored(projectDir);

		expect(firstChanged).toBe(false);
		expect(secondChanged).toBe(false);
		expect(await readFile(join(projectDir, '.gitignore'), 'utf8')).toBe(
			'dist\nnode_modules\n',
		);
		expect(existsSync(join(projectDir, '.otto', '.gitignore'))).toBe(false);
	});

	test('removes existing blanket .otto ignore variants without replacements', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });
		await writeFile(join(projectDir, '.gitignore'), 'dist\n/.otto/\n');

		const changed = await ensureProjectOttoIgnored(projectDir);

		expect(changed).toBe(true);
		expect(await readFile(join(projectDir, '.gitignore'), 'utf8')).toBe(
			'dist\n',
		);
		expect(existsSync(join(projectDir, '.otto', '.gitignore'))).toBe(false);
	});

	test('removes root and nested runtime patterns without replacements', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });
		await writeFile(
			join(projectDir, '.gitignore'),
			'dist\n.otto/otto.sqlite*\n.otto/attachments/\n**/.otto/cache/\n',
		);

		const changed = await ensureProjectOttoIgnored(projectDir);

		expect(changed).toBe(true);
		expect(await readFile(join(projectDir, '.gitignore'), 'utf8')).toBe(
			'dist\n',
		);
	});

	test('does not modify existing project .otto gitignore entries', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });
		await mkdir(join(projectDir, '.otto'), { recursive: true });
		await writeFile(join(projectDir, '.otto', '.gitignore'), 'custom.tmp\n');

		const changed = await ensureProjectOttoIgnored(projectDir);

		expect(changed).toBe(false);
		expect(
			await readFile(join(projectDir, '.otto', '.gitignore'), 'utf8'),
		).toBe('custom.tmp\n');
		expect(existsSync(join(projectDir, '.gitignore'))).toBe(false);
	});

	test('subdirectory invocation does not create otto gitignore files', async () => {
		await execFileAsync('git', ['init'], { cwd: projectDir });
		const subdir = join(projectDir, 'packages', 'app');
		await mkdir(subdir, { recursive: true });

		const changed = await ensureProjectOttoIgnored(subdir);

		expect(changed).toBe(false);
		expect(existsSync(join(projectDir, '.gitignore'))).toBe(false);
		expect(existsSync(join(subdir, '.otto'))).toBe(false);
		expect(existsSync(join(projectDir, '.otto'))).toBe(false);
	});
});
