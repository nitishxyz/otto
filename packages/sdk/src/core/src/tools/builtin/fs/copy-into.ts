import { readFile, writeFile } from 'node:fs/promises';
import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import DESCRIPTION from './copy-into.txt' with { type: 'text' };
import {
	buildMutationMetadata,
	buildWriteArtifact,
	isAbsoluteLike,
	resolveSafePath,
} from './util.ts';
import {
	convertToLineEnding,
	detectLineEnding,
	normalizeLineEndings,
} from './edit-shared.ts';
import { assertFreshRead, rememberFileWrite } from './read-tracker.ts';
import { createToolError, type ToolResponse } from '../../error.ts';

const lineEndpointSchema = z.union([
	z.number().int().min(1),
	z.literal('end'),
	z.literal('eof'),
]);

const insertAtLineSchema = z.union([
	z.number().int().min(1),
	z.literal('append'),
	z.literal('end'),
	z.literal('eof'),
]);

const copyIntoSchema = z.object({
	sourcePath: z
		.string()
		.describe('Relative source file path within the project.'),
	startLine: z
		.number()
		.int()
		.min(1)
		.describe('First source line to copy, 1-indexed and inclusive.'),
	endLine: lineEndpointSchema.describe(
		'Last source line to copy, 1-indexed and inclusive. Use "end" or "eof" to copy through the end of the file.',
	),
	targetPath: z
		.string()
		.describe('Relative target file path within the project.'),
	insertAtLine: insertAtLineSchema
		.optional()
		.describe(
			'Line to insert before, 1-indexed. Use "append" to add to the end.',
		),
	mode: z
		.enum(['insert_before', 'insert_after', 'replace_range'])
		.optional()
		.default('insert_before')
		.describe('How to apply copied content to the target file.'),
	targetStartLine: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe('First target line to replace when mode is replace_range.'),
	targetEndLine: lineEndpointSchema
		.optional()
		.describe(
			'Last target line to replace when mode is replace_range. Use "end" or "eof" to replace through the end of the file.',
		),
});

type CopyIntoInput = z.infer<typeof copyIntoSchema>;
type LineEndpoint = z.infer<typeof lineEndpointSchema>;

function splitLinesForEdit(content: string): {
	lines: string[];
	trailingNewline: boolean;
} {
	const normalized = normalizeLineEndings(content);
	const trailingNewline = normalized.endsWith('\n');
	const lines = normalized.split('\n');
	if (trailingNewline) lines.pop();
	return { lines, trailingNewline };
}

function joinLinesForEdit(lines: string[], trailingNewline: boolean): string {
	const joined = lines.join('\n');
	return trailingNewline ? `${joined}\n` : joined;
}

function validateRelativePath(path: string, label: string): string | undefined {
	if (!path || path.trim().length === 0) {
		return `Missing required parameter: ${label}`;
	}
	if (isAbsoluteLike(path)) {
		return `Refusing to access outside project root: ${path}. Use a relative path within the project.`;
	}
	return undefined;
}

function resolveEndLine(value: LineEndpoint, lineCount: number): number {
	if (typeof value === 'number') return Math.min(value, lineCount);
	return lineCount;
}

function getLineRange(
	lines: string[],
	startLine: number,
	endLineInput: LineEndpoint,
): { copied: string[]; endLine: number } {
	if (startLine > lines.length) {
		throw new Error(
			`Source start line ${startLine} exceeds source file length (${lines.length} lines). Use read to confirm line numbers first.`,
		);
	}

	const endLine = resolveEndLine(endLineInput, lines.length);
	if (startLine > endLine) {
		throw new Error(
			`startLine must be less than or equal to endLine. Source file has ${lines.length} lines; use endLine: "end" to copy through EOF.`,
		);
	}

	return { copied: lines.slice(startLine - 1, endLine), endLine };
}

function applyCopiedLines(
	input: CopyIntoInput,
	targetLines: string[],
	copied: string[],
): { lines: string[]; targetRange: string } {
	const mode = input.mode ?? 'insert_before';
	if (mode === 'replace_range') {
		if (
			input.targetStartLine === undefined ||
			input.targetEndLine === undefined
		) {
			throw new Error(
				'targetStartLine and targetEndLine are required when mode is replace_range.',
			);
		}
		if (input.targetStartLine > targetLines.length) {
			throw new Error(
				`Target start line ${input.targetStartLine} exceeds target file length (${targetLines.length} lines). Use insertAtLine: "append" to append instead.`,
			);
		}

		const targetEndLine = resolveEndLine(
			input.targetEndLine,
			targetLines.length,
		);
		if (input.targetStartLine > targetEndLine) {
			throw new Error(
				`targetStartLine must be less than or equal to targetEndLine. Target file has ${targetLines.length} lines; use targetEndLine: "end" to replace through EOF.`,
			);
		}

		return {
			lines: [
				...targetLines.slice(0, input.targetStartLine - 1),
				...copied,
				...targetLines.slice(targetEndLine),
			],
			targetRange: `${input.targetStartLine}-${targetEndLine}`,
		};
	}

	if (input.insertAtLine === undefined) {
		throw new Error(
			'insertAtLine is required for insert_before and insert_after modes.',
		);
	}

	const insertAtLine =
		typeof input.insertAtLine === 'number'
			? Math.min(
					input.insertAtLine,
					mode === 'insert_after' ? targetLines.length : targetLines.length + 1,
				)
			: mode === 'insert_after'
				? targetLines.length
				: targetLines.length + 1;
	const insertIndex = mode === 'insert_after' ? insertAtLine : insertAtLine - 1;
	if (insertIndex < 0 || insertIndex > targetLines.length) {
		throw new Error(
			`insertAtLine ${String(input.insertAtLine)} is outside the target file. Use insertAtLine: "append" to append.`,
		);
	}

	return {
		lines: [
			...targetLines.slice(0, insertIndex),
			...copied,
			...targetLines.slice(insertIndex),
		],
		targetRange: `${insertAtLine}`,
	};
}

export function buildCopyIntoTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	const copyInto = tool({
		description: DESCRIPTION,
		inputSchema: copyIntoSchema,
		async execute(input: CopyIntoInput): Promise<
			ToolResponse<{
				operation: 'copy_into';
				sourcePath: string;
				targetPath: string;
				sourceRange: string;
				targetRange: string;
				mode: string;
				linesCopied: number;
				bytes: number;
				bytesWritten: number;
				changed: boolean;
				sha256: string;
				summary: { files: number; additions: number; deletions: number };
				artifact: unknown;
			}>
		> {
			const sourcePathError = validateRelativePath(
				input.sourcePath,
				'sourcePath',
			);
			if (sourcePathError) {
				return createToolError(sourcePathError, 'validation', {
					parameter: 'sourcePath',
					value: input.sourcePath,
					suggestion: 'Use a relative path within the project',
				});
			}
			const targetPathError = validateRelativePath(
				input.targetPath,
				'targetPath',
			);
			if (targetPathError) {
				return createToolError(targetPathError, 'validation', {
					parameter: 'targetPath',
					value: input.targetPath,
					suggestion: 'Use a relative path within the project',
				});
			}

			const sourceAbs = resolveSafePath(projectRoot, input.sourcePath);
			const targetAbs = resolveSafePath(projectRoot, input.targetPath);

			try {
				await assertFreshRead(projectRoot, targetAbs, input.targetPath);
				const [sourceContent, targetContent] = await Promise.all([
					readFile(sourceAbs, 'utf-8'),
					readFile(targetAbs, 'utf-8'),
				]);
				const source = splitLinesForEdit(sourceContent);
				const sourceRange = getLineRange(
					source.lines,
					input.startLine,
					input.endLine,
				);
				const target = splitLinesForEdit(targetContent);
				const applied = applyCopiedLines(
					input,
					target.lines,
					sourceRange.copied,
				);
				const nextNormalized = joinLinesForEdit(
					applied.lines,
					target.trailingNewline,
				);
				const nextContent = convertToLineEnding(
					nextNormalized,
					detectLineEnding(targetContent),
				);

				if (nextContent === targetContent) {
					return createToolError('No changes applied.', 'validation', {
						suggestion:
							'Choose a source range or target location that changes the file',
					});
				}

				await writeFile(targetAbs, nextContent, 'utf-8');
				await rememberFileWrite(projectRoot, targetAbs);
				const metadata = buildMutationMetadata(targetContent, nextContent);
				const artifact = await buildWriteArtifact(
					input.targetPath,
					true,
					targetContent,
					nextContent,
				);
				return {
					ok: true,
					operation: 'copy_into',
					sourcePath: input.sourcePath,
					targetPath: input.targetPath,
					sourceRange: `${input.startLine}-${sourceRange.endLine}`,
					targetRange: applied.targetRange,
					mode: input.mode ?? 'insert_before',
					linesCopied: sourceRange.copied.length,
					bytes: metadata.bytesWritten,
					bytesWritten: metadata.bytesWritten,
					changed: metadata.changed,
					sha256: metadata.sha256,
					summary: metadata.summary,
					artifact,
				};
			} catch (error: unknown) {
				const isEnoent =
					error &&
					typeof error === 'object' &&
					'code' in error &&
					error.code === 'ENOENT';
				return createToolError(
					isEnoent
						? 'Source or target file not found.'
						: `Failed to copy into file: ${error instanceof Error ? error.message : String(error)}`,
					isEnoent ? 'not_found' : 'execution',
					{
						suggestion: isEnoent
							? 'Use read, ls, or tree to confirm both file paths first'
							: undefined,
					},
				);
			}
		},
	});

	return { name: 'copy_into', tool: copyInto };
}
