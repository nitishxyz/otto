import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPatchOperations } from '../packages/sdk/src/core/src/tools/builtin/patch/apply.ts';
import type { PatchApplyOptions } from '../packages/sdk/src/core/src/tools/builtin/patch/plan.ts';
import { parseEnvelopedPatch } from '../packages/sdk/src/core/src/tools/builtin/patch/parse-enveloped.ts';

let base: string;
let root: string;
let outside: string;
beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), 'harness-patch-policy-'));
	root = join(base, 'project');
	outside = join(base, 'outside');
	await mkdir(root);
	await mkdir(outside);
	await writeFile(join(root, 'safe'), 'old\n');
	await writeFile(join(outside, 'victim'), 'old\n');
	await symlink(outside, join(root, 'escape'));
	await symlink(join(outside, 'missing'), join(root, 'dangling'));
});
afterEach(async () => {
	await rm(base, { recursive: true, force: true });
});
const apply = (body: string, options: Partial<PatchApplyOptions> = {}) =>
	applyPatchOperations(
		root,
		parseEnvelopedPatch(`*** Begin Patch\n${body}\n*** End Patch`),
		{ useFuzzy: false, allowRejects: false, ...options },
	);
const safeUpdate = '*** Replace in: safe\n*** Find:\nold\n*** With:\nnew\n';
for (const [name, body] of [
	['add', '*** Add File: escape/new/deep\n+new'],
	['delete', '*** Delete File: escape/victim'],
	['update', '*** Update File: escape/victim\n@@\n-old\n+new'],
	['replace', '*** Replace in: escape/victim\n*** Find:\nold\n*** With:\nnew'],
	['line delete', '*** Delete Lines in: escape/victim\n*** Lines: 1-1'],
	[
		'line replace',
		'*** Replace Lines in: escape/victim\n*** Lines: 1-1\n*** With:\nnew',
	],
	[
		'line insert',
		'*** Insert Before in: escape/victim\n*** Line: 1\n*** With:\nnew',
	],
	['dangling target', '*** Add File: dangling\n+new'],
	['dangling parent', '*** Add File: dangling/child\n+new'],
] as const) {
	test(`${name}: canonical rejection leaves every file untouched`, async () => {
		await expect(
			apply(safeUpdate + body, { allowRejects: true }),
		).rejects.toThrow();
		expect(await readFile(join(root, 'safe'), 'utf8')).toBe('old\n');
		expect(await readFile(join(outside, 'victim'), 'utf8')).toBe('old\n');
	});
}
test('adds use the nearest existing canonical parent within the project', async () => {
	await mkdir(join(root, 'real'));
	await symlink(join(root, 'real'), join(root, 'alias'));
	await apply('*** Add File: alias/new/deep\n+new');
	expect(await readFile(join(root, 'real/new/deep'), 'utf8')).toBe('new\n');
});
test('updates through in-project aliases mutate the target rather than replacing the link', async () => {
	await symlink(join(root, 'safe'), join(root, 'alias'));
	await apply('*** Replace in: alias\n*** Find:\nold\n*** With:\nnew');
	expect(await readFile(join(root, 'safe'), 'utf8')).toBe('new\n');
});
test('nested read-only roots cannot be mutated via an alias', async () => {
	await mkdir(join(root, 'reference'));
	await writeFile(join(root, 'reference/file'), 'old\n');
	await symlink(join(root, 'reference'), join(root, 'alias'));
	await expect(
		apply(safeUpdate + '*** Delete File: alias/file', {
			readOnlyRoots: [join(root, 'reference')],
		}),
	).rejects.toThrow('read-only');
	expect(await readFile(join(root, 'safe'), 'utf8')).toBe('old\n');
	expect(await readFile(join(root, 'reference/file'), 'utf8')).toBe('old\n');
});
test('custom path hooks cannot bypass canonical confinement', async () => {
	await expect(
		apply(safeUpdate, { resolvePath: () => join(outside, 'victim') }),
	).rejects.toThrow();
	expect(await readFile(join(root, 'safe'), 'utf8')).toBe('old\n');
});
