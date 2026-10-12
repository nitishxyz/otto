import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPatchOperations } from '../packages/sdk/src/core/src/tools/builtin/patch/apply.ts';
import { parseEnvelopedPatch } from '../packages/sdk/src/core/src/tools/builtin/patch/parse-enveloped.ts';

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'harness-patch-'));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
const apply = (body: string) =>
	applyPatchOperations(
		root,
		parseEnvelopedPatch(`*** Begin Patch\n${body}\n*** End Patch`),
		{ useFuzzy: true, allowRejects: false },
	);

test('validates all operations before mutating any file', async () => {
	await writeFile(join(root, 'a'), 'old\n');
	await expect(
		apply(
			'*** Replace in: a\n*** Find:\nold\n*** With:\nnew\n*** Delete File: missing',
		),
	).rejects.toThrow();
	expect(await readFile(join(root, 'a'), 'utf8')).toBe('old\n');
});
test('add cannot overwrite an existing file', async () => {
	await writeFile(join(root, 'a'), 'old\n');
	await expect(apply('*** Add File: a\n+new')).rejects.toThrow();
	expect(await readFile(join(root, 'a'), 'utf8')).toBe('old\n');
});
test('missing removals never become partial semantic matches', async () => {
	await writeFile(join(root, 'a'), 'start\nfirst\nend\n');
	await expect(
		apply('*** Update File: a\n@@\n start\n-first\n-missing\n+new\n end'),
	).rejects.toThrow();
	expect(await readFile(join(root, 'a'), 'utf8')).toBe('start\nfirst\nend\n');
});
test('removal-only hunks require every line, not a majority', async () => {
	await writeFile(join(root, 'a'), 'first\nactual\nlast\n');
	await expect(
		apply('*** Update File: a\n@@\n-first\n-invented\n-last\n+new'),
	).rejects.toThrow();
});
test('duplicate whole-block matches are rejected', async () => {
	await writeFile(join(root, 'a'), 'old\nold\n');
	await expect(
		apply('*** Replace in: a\n*** Find:\nold\n*** With:\nnew'),
	).rejects.toThrow(/ambiguous/i);
});
test('commit failure reports the failed path and rolls back applied files', async () => {
	const canonicalRoot = await realpath(root);
	await writeFile(join(root, 'existing'), 'original\n');
	let failure: unknown;
	try {
		await apply(
			'*** Replace in: existing\n*** Find:\noriginal\n*** With:\nchanged\n*** Add File: parent\n+file\n*** Add File: parent/child\n+child',
		);
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(Error);
	const message = (failure as Error).message;
	expect(
		message.startsWith(
			`Patch commit failed at ${join(canonicalRoot, 'parent/child')}: `,
		),
	).toBe(true);
	expect(message).toContain(
		`Applied before failure: ${join(canonicalRoot, 'existing')}, ${join(canonicalRoot, 'parent')}. All applied writes rolled back.`,
	);
	expect(await readFile(join(root, 'existing'), 'utf8')).toBe('original\n');
	await expect(readFile(join(root, 'parent'))).rejects.toMatchObject({
		code: 'ENOENT',
	});
});
