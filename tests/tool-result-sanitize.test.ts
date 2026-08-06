import { describe, expect, it } from 'bun:test';
import { tool } from 'ai';
import { z } from 'zod/v3';
import { adaptTools } from '../packages/server/src/tools/adapter.ts';
import type { ToolAdapterContext } from '../packages/server/src/tools/adapter.ts';
import {
	buildToolResultContent,
	stripToolResultArtifactsForModel,
} from '../packages/server/src/tools/adapter/results.ts';
import {
	extractBrowserScreenshot,
	referenceBrowserScreenshot,
	sanitizeInlineImageDataJson,
	stringifyWithoutInlineImageData,
} from '../packages/server/src/tools/adapter/browser-artifact.ts';

describe('tool result model sanitization', () => {
	it('keeps browser screenshot bytes once in persisted tool content', () => {
		const artifact = {
			kind: 'browser_screenshot',
			mediaType: 'image/png',
			data: 'aGVsbG8=',
		};
		const content = buildToolResultContent({
			name: 'browser',
			result: { ok: true, artifact },
			callId: 'call/1',
		});

		expect(content.result).toEqual({ ok: true, artifact });
		expect(content.artifact).toBeUndefined();
	});

	it('replaces inline browser screenshot bytes with an artifact URL', () => {
		const data = 'a'.repeat(1_000_000);
		const artifact = {
			kind: 'browser_screenshot',
			mediaType: 'image/png',
			data,
		};
		const content = {
			name: 'browser',
			result: { ok: true, artifact },
			artifact,
			callId: 'call/1',
		};

		expect(extractBrowserScreenshot(content)).toEqual({
			data,
			mediaType: 'image/png',
		});
		const referenced = referenceBrowserScreenshot(
			content,
			'session 1',
			'call/1',
		);
		const serialized = JSON.stringify(referenced);

		expect(serialized).not.toContain(data);
		expect(serialized.length).toBeLessThan(1_000);
		expect(serialized).toContain(
			'/v1/sessions/session%201/tool-results/call%2F1/artifact',
		);
	});

	it('omits inline images from finish diagnostics', () => {
		const data = 'a'.repeat(1_000_000);
		const details = {
			response: {
				messages: [
					{
						content: [
							{ type: 'text', text: 'screenshot' },
							{ type: 'image-data', data, mediaType: 'image/png' },
						],
					},
				],
			},
		};
		const sanitized = stringifyWithoutInlineImageData(details);

		expect(sanitized).not.toContain(data);
		expect(sanitized).toContain('image-data');
		expect(sanitizeInlineImageDataJson(JSON.stringify(details))).toBe(
			sanitized,
		);
	});

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

	it('caps search matches for model-visible history', () => {
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
			toolName: 'search',
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

	it('lets custom model outputs render image artifacts directly', () => {
		const imageTool = tool({
			description: 'test image tool',
			inputSchema: z.object({}),
			execute: async () => ({ ok: true }),
			toModelOutput({ output }) {
				const artifact = (output as { artifact?: { data?: string } }).artifact;
				return {
					type: 'content',
					value: [
						{
							type: 'image-data',
							data: artifact?.data ?? '',
							mediaType: 'image/png',
						},
					],
				};
			},
		});
		const adapted = adaptTools([{ name: 'custom_image', tool: imageTool }], {
			sessionId: 'session',
			messageId: 'message',
			assistantPartId: 'assistant-part',
			db: {} as ToolAdapterContext['db'],
			agent: 'default',
			provider: 'openai',
			model: 'model',
			projectRoot: '/tmp/project',
			nextIndex: () => 0,
		});

		const modelOutput = adapted.custom_image?.toModelOutput?.({
			toolCallId: 'call-1',
			input: {},
			output: {
				ok: true,
				artifact: { kind: 'simulator_screenshot', data: 'base64-image' },
			},
		});

		expect(modelOutput).toEqual({
			type: 'content',
			value: [
				{
					type: 'image-data',
					data: 'base64-image',
					mediaType: 'image/png',
				},
			],
		});
	});
});
