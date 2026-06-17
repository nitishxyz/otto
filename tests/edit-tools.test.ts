import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverProjectTools } from '@ottocode/sdk';

let testDir: string;
let projectRoot: string;

beforeAll(async () => {
	testDir = await mkdtemp(join(tmpdir(), 'otto-edit-tools-'));
	projectRoot = join(testDir, 'project');
	await mkdir(projectRoot, { recursive: true });
	await writeFile(
		join(projectRoot, 'sample.ts'),
		[
			'export function greet() {',
			'\tconst label = "hello";',
			'\treturn label;',
			'}',
			'',
			'export function duplicate() {',
			'\treturn "same";',
			'}',
			'',
			'export function duplicateAgain() {',
			'\treturn "same";',
			'}',
		].join('\n'),
	);
});

afterAll(async () => {
	await rm(testDir, { recursive: true, force: true });
});

const interpolatedReturnLine = '\treturn `' + '$' + '{label}!' + '`;';

describe('edit and multiedit tools', () => {
	it('requires read before edit', async () => {
		const { tools } = await discoverProjectTools(projectRoot);
		const editTool = tools.find((tool) => tool.name === 'edit');
		expect(editTool).toBeDefined();

		const result = await editTool?.tool.execute({
			path: 'sample.ts',
			oldString: 'const label = "hello";',
			newString: 'const label = "hi";',
		});

		expect(result).toMatchObject({ ok: false });
		expect((result as { error: string }).error).toContain('read tool first');
	});

	it('applies exact replacement after read', async () => {
		const { tools } = await discoverProjectTools(projectRoot);
		const readTool = tools.find((tool) => tool.name === 'read');
		const editTool = tools.find((tool) => tool.name === 'edit');
		await readTool?.tool.execute({ path: 'sample.ts' });

		const result = await editTool?.tool.execute({
			path: 'sample.ts',
			oldString: '\tconst label = "hello";',
			newString: '\tconst label = "hi";',
		});

		expect(result).toMatchObject({
			ok: true,
			path: 'sample.ts',
			occurrences: 1,
		});
		const updated = await Bun.file(join(projectRoot, 'sample.ts')).text();
		expect(updated).toContain('\tconst label = "hi";');
	});

	it('applies unique line replacement with whitespace-only oldString drift', async () => {
		await writeFile(
			join(projectRoot, 'fuzzy.ts'),
			[
				'export function renderUser() {',
				'\tconst label = formatName(user.firstName, user.lastName);',
				'\treturn label;',
				'}',
			].join('\n'),
		);
		const { tools } = await discoverProjectTools(projectRoot);
		const readTool = tools.find((tool) => tool.name === 'read');
		const editTool = tools.find((tool) => tool.name === 'edit');
		await readTool?.tool.execute({ path: 'fuzzy.ts' });

		const result = await editTool?.tool.execute({
			path: 'fuzzy.ts',
			oldString:
				'  const   label   =   formatName(user.firstName,   user.lastName);',
			newString: '  const label = formatDisplayName(user);',
		});

		expect(result).toMatchObject({
			ok: true,
			path: 'fuzzy.ts',
			occurrences: 1,
		});
		const updated = await Bun.file(join(projectRoot, 'fuzzy.ts')).text();
		expect(updated).toContain('\tconst label = formatDisplayName(user);');
	});

	it('fails when oldString matches multiple times without replaceAll', async () => {
		const { tools } = await discoverProjectTools(projectRoot);
		const readTool = tools.find((tool) => tool.name === 'read');
		const editTool = tools.find((tool) => tool.name === 'edit');
		await readTool?.tool.execute({ path: 'sample.ts' });

		const result = await editTool?.tool.execute({
			path: 'sample.ts',
			oldString: 'return "same";',
			newString: 'return "changed";',
		});

		expect(result).toMatchObject({ ok: false });
		expect((result as { error: string }).error).toContain('multiple matches');
	});

	it('applies multiedit atomically after read', async () => {
		const { tools } = await discoverProjectTools(projectRoot);
		const readTool = tools.find((tool) => tool.name === 'read');
		const multieditTool = tools.find((tool) => tool.name === 'multiedit');
		await readTool?.tool.execute({ path: 'sample.ts' });

		const result = await multieditTool?.tool.execute({
			path: 'sample.ts',
			edits: [
				{
					oldString: 'export function greet() {',
					newString: 'export function greetUser() {',
				},
				{
					oldString: '\treturn label;',
					newString: interpolatedReturnLine,
				},
			],
		});

		expect(result).toMatchObject({
			ok: true,
			path: 'sample.ts',
			editsApplied: 2,
		});
		const updated = await Bun.file(join(projectRoot, 'sample.ts')).text();
		expect(updated).toContain('export function greetUser() {');
		expect(updated).toContain(interpolatedReturnLine);
	});

	it('rejects stale edits when file changes after read', async () => {
		const { tools } = await discoverProjectTools(projectRoot);
		const readTool = tools.find((tool) => tool.name === 'read');
		const editTool = tools.find((tool) => tool.name === 'edit');
		await readTool?.tool.execute({ path: 'sample.ts' });
		await writeFile(
			join(projectRoot, 'sample.ts'),
			[
				'export function greetUser() {',
				'\tconst label = "bonjour";',
				interpolatedReturnLine,
				'}',
			].join('\n'),
		);

		const result = await editTool?.tool.execute({
			path: 'sample.ts',
			oldString: '\tconst label = "hi";',
			newString: '\tconst label = "hey";',
		});

		expect(result).toMatchObject({ ok: false });
		expect((result as { error: string }).error).toContain(
			'changed since it was last read',
		);
	});
});
