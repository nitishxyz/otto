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

	it('caps large shell output for model-visible history', () => {
		const result = {
			ok: true,
			exitCode: 0,
			stdout: `head-${'x'.repeat(80_000)}-tail`,
			stderr: '',
		};

		const sanitized = stripToolResultArtifactsForModel(result, {
			toolName: 'shell',
		}) as { stdout: string; stdoutTruncated?: boolean };

		expect(sanitized.stdout.length).toBeLessThan(result.stdout.length);
		expect(sanitized.stdout).toContain('head-');
		expect(sanitized.stdout).toContain('-tail');
		expect(sanitized.stdout).toContain('omitted');
		expect(sanitized.stdoutTruncated).toBe(true);
	});

	it('caps ripgrep matches for model-visible history', () => {
		const result = {
			ok: true,
			count: 200,
			matches: Array.from({ length: 200 }, (_, index) => ({
				file: 'src/file.ts',
				line: index + 1,
				text: 'needle',
			})),
		};

		const sanitized = stripToolResultArtifactsForModel(result, {
			toolName: 'ripgrep',
		}) as { matches: unknown[]; truncated?: boolean; originalMatches?: number };

		expect(sanitized.matches).toHaveLength(80);
		expect(sanitized.truncated).toBe(true);
		expect(sanitized.originalMatches).toBe(200);
	});

	it('compacts superseded read results for model-visible history', () => {
		const result = {
			ok: true,
			path: 'src/file.ts',
			content: 'important content',
			size: 17,
			lineRange: '@1-10',
			totalLines: 100,
		};

		const sanitized = stripToolResultArtifactsForModel(result, {
			toolName: 'read',
			compactedReason: 'Superseded by a later read.',
		}) as { content?: string; compacted?: boolean; compactedReason?: string };

		expect(sanitized.content).toBeUndefined();
		expect(sanitized.compacted).toBe(true);
		expect(sanitized.compactedReason).toContain('Superseded');
	});
});
