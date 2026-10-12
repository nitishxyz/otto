import { expect, test } from 'bun:test';
import { buildDiffContent } from '../packages/acp/src/tools';
import { reversePatchForFile } from '../packages/acp/src/patch-reconstruction';

test('historical diffs use persisted snapshots without reading changed disk', () => {
	const content = buildDiffContent(
		'edit',
		{ path: 'file.txt' },
		{
			artifact: {
				kind: 'file_diff',
				patch: '--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new',
			},
			changes: [
				{
					filePath: 'file.txt',
					kind: 'update',
					oldText: 'old',
					newText: 'new',
				},
			],
		},
		'/does/not/exist',
	);
	expect(content).toEqual([
		{
			type: 'diff',
			path: '/does/not/exist/file.txt',
			oldText: 'old',
			newText: 'new',
		},
	]);
});

test('patch reconstruction refuses unrelated current disk contents', () => {
	const patch = '--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new';
	expect(reversePatchForFile(patch, 'file.txt', 'new')).toBe('old');
	expect(reversePatchForFile(patch, 'file.txt', 'later edit')).toBeNull();
});
