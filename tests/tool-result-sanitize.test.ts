import { describe, expect, it } from 'bun:test';
import { stripToolResultArtifactsForModel } from '../packages/server/src/tools/adapter/results.ts';

describe('tool result model sanitization', () => {
	it('removes UI artifacts from model-visible tool output', () => {
		const result = {
			ok: true,
			path: 'src/file.ts',
			operation: 'write',
			bytesWritten: 42,
			artifact: {
				kind: 'file_diff',
				patch: 'very large diff',
			},
		};

		expect(stripToolResultArtifactsForModel(result)).toEqual({
			ok: true,
			path: 'src/file.ts',
			operation: 'write',
			bytesWritten: 42,
		});
	});

	it('removes apply_patch hunk details from model-visible output', () => {
		const result = {
			ok: true,
			operation: 'apply_patch',
			changed: true,
			summary: { files: 1, additions: 2, deletions: 1 },
			changes: [
				{
					filePath: 'src/file.ts',
					kind: 'update',
					hunks: [{ oldStart: 1, newStart: 1 }],
				},
			],
			artifact: {
				kind: 'file_diff',
				patch: 'large normalized patch',
			},
		};

		expect(stripToolResultArtifactsForModel(result)).toEqual({
			ok: true,
			operation: 'apply_patch',
			changed: true,
			summary: { files: 1, additions: 2, deletions: 1 },
		});
	});
});
