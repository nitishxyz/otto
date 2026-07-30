import { describe, expect, it } from 'bun:test';

import { parsePatchInput } from '../packages/sdk/src/core/src/tools/builtin/patch/parse.ts';
import { repairPatchContent } from '../packages/sdk/src/core/src/tools/builtin/patch/repair.ts';

describe('parsePatchInput', () => {
	it('parses unified diffs even when body contains "*** Begin Patch"', () => {
		const patch = [
			'diff --git a/test.txt b/test.txt',
			'--- a/test.txt',
			'+++ b/test.txt',
			'@@ -1 +1,2 @@',
			'-hello',
			'+hello',
			'+*** Begin Patch',
		].join('\n');

		const result = parsePatchInput(patch);

		expect(result.format).toBe('unified');
		expect(result.operations).toHaveLength(1);
		expect(result.operations[0]).toMatchObject({
			kind: 'update',
			filePath: 'test.txt',
		});
	});

	it('repairs missing end markers for line-number patches', () => {
		const patch = [
			'*** Begin Patch',
			'*** Replace Lines in: test.txt',
			'*** Lines: 1-1',
			'*** With:',
			'hello',
		].join('\n');

		const result = parsePatchInput(repairPatchContent(patch));

		expect(result.format).toBe('enveloped');
		expect(result.operations).toHaveLength(1);
		expect(result.operations[0]).toMatchObject({
			kind: 'line-replace',
			filePath: 'test.txt',
		});
	});

	it('extracts enveloped patches from harmless prose wrappers', () => {
		const patch = [
			'Here is the patch:',
			'```text',
			'*** Begin Patch',
			'*** Replace Lines in: test.txt',
			'*** Lines: 1-1',
			'*** With:',
			'hello',
			'*** End Patch',
			'```',
		].join('\n');

		const repaired = repairPatchContent(patch);
		const result = parsePatchInput(repaired);

		expect(repaired.startsWith('*** Begin Patch')).toBe(true);
		expect(repaired.endsWith('*** End Patch')).toBe(true);
		expect(result.format).toBe('enveloped');
		expect(result.operations).toHaveLength(1);
	});

	it('trims accidental content after the end marker', () => {
		const patch = [
			'*** Begin Patch',
			'*** Replace Lines in: test.txt',
			'*** Lines: 1-1',
			'*** With:',
			'hello',
			'*** End Patch',
			'This sentence should not make parsing fail.',
		].join('\n');

		const repaired = repairPatchContent(patch);
		const result = parsePatchInput(repaired);

		expect(repaired).not.toContain(
			'This sentence should not make parsing fail.',
		);
		expect(result.format).toBe('enveloped');
		expect(result.operations).toHaveLength(1);
	});

	it('repairs missing end markers before a closing markdown fence', () => {
		const patch = [
			'```text',
			'*** Begin Patch',
			'*** Replace Lines in: test.txt',
			'*** Lines: 1-1',
			'*** With:',
			'hello',
			'```',
		].join('\n');

		const repaired = repairPatchContent(patch);
		const result = parsePatchInput(repaired);

		expect(repaired).not.toContain('```');
		expect(repaired.endsWith('*** End Patch')).toBe(true);
		expect(result.format).toBe('enveloped');
		expect(result.operations).toHaveLength(1);
	});

	it('recovers Find/With blocks mistakenly written under Update File', () => {
		const patch = [
			'*** Begin Patch',
			'*** Update File: workflow.yml',
			'*** Find:',
			'old line one',
			'old line two',
			'*** With:',
			'new line one',
			'new line two',
			'*** End Patch',
		].join('\n');

		const result = parsePatchInput(patch);

		expect(result.operations).toHaveLength(1);
		const op = result.operations[0];
		expect(op).toMatchObject({ kind: 'update', filePath: 'workflow.yml' });
		if (op.kind !== 'update') throw new Error('expected update operation');
		expect(op.hunks).toHaveLength(1);
		expect(op.hunks[0].lines).toEqual([
			{ kind: 'remove', content: 'old line one' },
			{ kind: 'remove', content: 'old line two' },
			{ kind: 'add', content: 'new line one' },
			{ kind: 'add', content: 'new line two' },
		]);
	});

	it('keeps prior hunks when Update File switches to Find/With mid-section', () => {
		const patch = [
			'*** Begin Patch',
			'*** Update File: file.ts',
			' context',
			'-old',
			'+new',
			'*** Find:',
			'foo',
			'*** With:',
			'bar',
			'*** End Patch',
		].join('\n');

		const result = parsePatchInput(patch);

		expect(result.operations).toHaveLength(2);
		expect(result.operations[0]).toMatchObject({
			kind: 'update',
			filePath: 'file.ts',
		});
		expect(result.operations[1]).toMatchObject({
			kind: 'update',
			filePath: 'file.ts',
		});
	});

	it('recovers Lines/With blocks mistakenly written under Update File', () => {
		const patch = [
			'*** Begin Patch',
			'*** Update File: test.txt',
			'*** Lines: 2-3',
			'*** With:',
			'replacement',
			'*** End Patch',
		].join('\n');

		const result = parsePatchInput(patch);

		expect(result.operations).toHaveLength(1);
		expect(result.operations[0]).toMatchObject({
			kind: 'line-replace',
			filePath: 'test.txt',
			startLine: 2,
			endLine: 3,
		});
	});

	it('accepts case-insensitive directives', () => {
		const patch = [
			'*** begin patch',
			'*** update file: test.txt',
			' context',
			'-old',
			'+new',
			'*** end patch',
		].join('\n');

		const result = parsePatchInput(patch);

		expect(result.format).toBe('enveloped');
		expect(result.operations).toHaveLength(1);
		expect(result.operations[0]).toMatchObject({
			kind: 'update',
			filePath: 'test.txt',
		});
	});

	it('rejects unknown directive-like lines instead of swallowing them', () => {
		const patch = [
			'*** Begin Patch',
			'*** Update File: test.txt',
			'*** Modify:',
			' context',
			'*** End Patch',
		].join('\n');

		expect(() => parsePatchInput(patch)).toThrow('Unrecognized directive');
	});

	it('does not truncate patches whose content mentions the end marker mid-line', () => {
		const patch = [
			'*** Begin Patch',
			'*** Add File: docs/patch-format.md',
			'+Wrap patches between markers; the closing marker is *** End Patch on its own line.',
			'*** End Patch',
		].join('\n');

		const repaired = repairPatchContent(patch);
		const result = parsePatchInput(repaired);

		expect(result.operations).toHaveLength(1);
		const op = result.operations[0];
		if (op.kind !== 'add') throw new Error('expected add operation');
		expect(op.lines[0]).toContain('closing marker');
	});
});
