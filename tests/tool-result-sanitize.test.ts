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
});
