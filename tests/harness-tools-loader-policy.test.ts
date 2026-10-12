import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	clearProjectToolDiscoveryCache,
	discoverProjectTools,
} from '@ottocode/sdk/tools';

test('discovered patch tools protect configured nested reference roots without leaking cached policy', async () => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'harness-tools-loader-'));
	try {
		const referenceRoot = join(projectRoot, 'reference');
		await mkdir(referenceRoot);
		const target = join(referenceRoot, 'file.txt');
		await writeFile(target, 'original\n');
		const patch =
			'*** Begin Patch\n*** Replace in: reference/file.txt\n*** Find:\noriginal\n*** With:\nchanged\n*** End Patch';
		const unrestricted = await discoverProjectTools(projectRoot, {
			enabled: false,
		});
		const restricted = await discoverProjectTools(
			projectRoot,
			{ enabled: false },
			[referenceRoot],
		);
		const restrictedTool = restricted.tools.find(
			({ name }) => name === 'apply_patch',
		)?.tool;
		expect(restrictedTool?.execute).toBeDefined();
		const blocked = await restrictedTool?.execute?.(
			{ patch } as never,
			{
				toolCallId: 'restricted',
				messages: [],
			} as never,
		);
		expect(blocked).toMatchObject({ ok: false });
		expect(JSON.stringify(blocked)).toMatch(/read.only/i);
		expect(await readFile(target, 'utf8')).toBe('original\n');
		const unrestrictedTool = unrestricted.tools.find(
			({ name }) => name === 'apply_patch',
		)?.tool;
		const allowed = await unrestrictedTool?.execute?.(
			{ patch } as never,
			{
				toolCallId: 'unrestricted',
				messages: [],
			} as never,
		);
		expect(allowed).toMatchObject({ ok: true });
		expect(await readFile(target, 'utf8')).toBe('changed\n');
	} finally {
		clearProjectToolDiscoveryCache(projectRoot);
		await rm(projectRoot, { recursive: true, force: true });
	}
});
