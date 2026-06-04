import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { readFile } from 'node:fs/promises';
import { expandTilde, isAbsoluteLike, resolveSafePath } from './util.ts';
import { rememberFileRead } from './read-tracker.ts';
import DESCRIPTION from './read.txt' with { type: 'text' };
import { createToolError, type ToolResponse } from '../../error.ts';

const embeddedTextAssets: Record<string, string> = {};

function detectIndentation(content: string): string | undefined {
	const lines = content.split('\n');
	let tabCount = 0;
	let spaceCount = 0;
	const spaceSizes: Record<number, number> = {};
	for (const line of lines) {
		if (line.length === 0) continue;
		const match = line.match(/^(\s+)/);
		if (!match) continue;
		const ws = match[1];
		if (ws.includes('\t')) {
			tabCount++;
		} else {
			spaceCount++;
			const len = ws.length;
			if (len > 0 && len <= 8) {
				spaceSizes[len] = (spaceSizes[len] || 0) + 1;
			}
		}
	}
	if (tabCount === 0 && spaceCount === 0) return undefined;
	if (tabCount > spaceCount) return 'tabs';
	const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
	const sizes = Object.keys(spaceSizes)
		.map(Number)
		.filter((s) => s > 0);
	if (sizes.length > 1) {
		return `${sizes.reduce((a, b) => gcd(a, b))} spaces`;
	}
	if (sizes.length === 1) {
		return `${sizes[0]} spaces`;
	}
	return '2 spaces';
}

type ReadResult = {
	ok: true;
	path: string;
	content: string;
	size: number;
	indentation?: string;
	lineRange?: string;
	totalLines?: number;
};

export function buildReadTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	const read = tool({
		description: DESCRIPTION,
		inputSchema: z.object({
			path: z
				.string()
				.describe(
					"File path. Relative to project root by default; absolute ('/...') and home ('~/...') paths are allowed.",
				),
			startLine: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe(
					'Starting line number (1-indexed). If provided, only reads lines from startLine to endLine.',
				),
			endLine: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe(
					'Ending line number (1-indexed, inclusive). Required if startLine is provided.',
				),
			maxLines: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe(
					'Number of lines to read starting at startLine. Ignored when endLine is provided.',
				),
		}),
		async execute({
			path,
			startLine,
			endLine,
			maxLines,
		}: {
			path: string;
			startLine?: number;
			endLine?: number;
			maxLines?: number;
		}): Promise<ToolResponse<ReadResult>> {
			if (!path || path.trim().length === 0) {
				return createToolError(
					'Missing required parameter: path',
					'validation',
					{
						parameter: 'path',
						value: path,
						suggestion: 'Provide a file path to read',
					},
				);
			}

			const req = expandTilde(path);
			const abs = isAbsoluteLike(req) ? req : resolveSafePath(projectRoot, req);

			try {
				let content = await readFile(abs, 'utf-8');
				const indent = detectIndentation(content);
				await rememberFileRead(projectRoot, abs);

				if (startLine !== undefined) {
					const lines = content.split('\n');
					const requestedEndLine =
						endLine ?? startLine + Math.max(1, maxLines ?? 1) - 1;
					const start = Math.max(1, startLine) - 1;
					const end = Math.min(lines.length, requestedEndLine);
					const selectedLines = lines.slice(start, end);
					content = selectedLines.join('\n');
					const result: ReadResult = {
						ok: true,
						path: req,
						content,
						size: content.length,
						lineRange: `@${startLine}-${requestedEndLine}`,
						totalLines: lines.length,
					};
					if (indent) result.indentation = indent;
					return result;
				}

				const result: ReadResult = {
					ok: true,
					path: req,
					content,
					size: content.length,
				};
				if (indent) result.indentation = indent;
				return result;
			} catch (error: unknown) {
				const embedded = embeddedTextAssets[req];
				if (embedded) {
					const content = await readFile(embedded, 'utf-8');
					return { ok: true, path: req, content, size: content.length };
				}
				const isEnoent =
					error &&
					typeof error === 'object' &&
					'code' in error &&
					error.code === 'ENOENT';
				return createToolError(
					isEnoent
						? `File not found: ${req}`
						: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
					isEnoent ? 'not_found' : 'execution',
					{
						parameter: 'path',
						value: req,
						suggestion: isEnoent
							? 'Use ls or tree to find available files'
							: undefined,
					},
				);
			}
		},
	});
	return { name: 'read', tool: read };
}
