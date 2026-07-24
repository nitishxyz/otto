import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
	dirname,
	relative as relativePath,
	resolve as resolvePath,
} from 'node:path';
import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import DESCRIPTION from './copy-into.txt' with { type: 'text' };
import {
	buildMutationMetadata,
	buildWriteArtifact,
	expandTilde,
	isAbsoluteLike,
	resolveSafePath,
} from './util.ts';
import {
	convertToLineEnding,
	detectLineEnding,
	normalizeLineEndings,
} from './edit-shared.ts';
import { getStaleReadHint, rememberFileWrite } from './read-tracker.ts';
import {
	createToolAbortError,
	createToolError,
	type ToolResponse,
} from '../../error.ts';

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
		.describe(
			"Source file path. Relative paths are resolved within the project; absolute ('/...') and home ('~/...') paths are allowed for copying from other projects.",
		),
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
		.describe(
			'Project target file path. Relative paths are resolved within the project; absolute paths are accepted when they are inside the project root.',
		),
	insertAtLine: insertAtLineSchema
		.optional()
		.describe(
			'Line to insert before, 1-indexed. Use "append" to add to the end. May be omitted when creating a target file.',
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

function validatePath(path: string, label: string): string | undefined {
	if (!path || path.trim().length === 0) {
		return `Missing required parameter: ${label}`;
	}
	return undefined;
}

function resolveSourcePath(projectRoot: string, path: string): string {
	const expanded = expandTilde(path);
	return isAbsoluteLike(expanded)
		? resolvePath(expanded)
		: resolveSafePath(projectRoot, expanded);
}

function resolveTargetPath(projectRoot: string, path: string): string {
	return resolveSafePath(projectRoot, expandTilde(path));
}

function toProjectRelativePath(projectRoot: string, absPath: string): string {
	const relative = relativePath(resolvePath(projectRoot), absPath) || '.';
	return relative.replace(/\\/g, '/');
}

function resolveEndLine(value: LineEndpoint, lineCount: number): number {
	if (typeof value === 'number') return Math.min(value, lineCount);
	return lineCount;
}

function isFileNotFoundError(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === 'object' &&
		'code' in error &&
		error.code === 'ENOENT'
	);
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
		if (targetLines.length === 0) {
			return { lines: copied, targetRange: '1' };
		}
		throw new Error(
			'insertAtLine is required for insert_before and insert_after modes.',
		);
	}
	if (targetLines.length === 0) {
		return { lines: copied, targetRange: '1' };
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
		async execute(
			input: CopyIntoInput,
			options?: { abortSignal?: AbortSignal },
		): Promise<
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
				created: boolean;
				changed: boolean;
				sha256: string;
				summary: { files: number; additions: number; deletions: number };
				artifact: unknown;
			}>
		> {
			const sourcePathError = validatePath(input.sourcePath, 'sourcePath');
			if (sourcePathError) {
				return createToolError(sourcePathError, 'validation', {
					parameter: 'sourcePath',
					value: input.sourcePath,
					suggestion: 'Use a relative path within the project',
				});
			}
			const targetPathError = validatePath(input.targetPath, 'targetPath');
			if (targetPathError) {
				return createToolError(targetPathError, 'validation', {
					parameter: 'targetPath',
					value: input.targetPath,
					suggestion: 'Use a relative path within the project',
				});
			}

			let sourceAbs: string;
			let targetAbs: string;
			try {
				sourceAbs = resolveSourcePath(projectRoot, input.sourcePath);
				targetAbs = resolveTargetPath(projectRoot, input.targetPath);
			} catch (error: unknown) {
				return createToolError(
					`Invalid source or target path: ${error instanceof Error ? error.message : String(error)}`,
					'validation',
					{
						suggestion:
							'Use a target path inside the current project. Source paths may be relative, absolute, or ~/ paths.',
					},
				);
			}
			const targetDisplayPath = toProjectRelativePath(projectRoot, targetAbs);

			try {
				const sourceContent = await readFile(sourceAbs, 'utf-8');
				let targetContent = '';
				let targetExisted = true;
				try {
					targetContent = await readFile(targetAbs, 'utf-8');
				} catch (error: unknown) {
					if (!isFileNotFoundError(error)) throw error;
					targetExisted = false;
				}
				const source = splitLinesForEdit(sourceContent);
				const sourceRange = getLineRange(
					source.lines,
					input.startLine,
					input.endLine,
				);
				const target = targetExisted
					? splitLinesForEdit(targetContent)
					: {
							lines: [],
							trailingNewline:
								sourceRange.endLine < source.lines.length ||
								source.trailingNewline,
						};
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
					detectLineEnding(targetExisted ? targetContent : sourceContent),
				);

				if (targetExisted && nextContent === targetContent) {
					return createToolError('No changes applied.', 'validation', {
						suggestion:
							'Choose a source range or target location that changes the file',
					});
				}

				if (options?.abortSignal?.aborted) {
					return createToolAbortError('Copy');
				}
				if (!targetExisted) {
					await mkdir(dirname(targetAbs), { recursive: true });
				}
				await writeFile(targetAbs, nextContent, 'utf-8');
				await rememberFileWrite(projectRoot, targetAbs);
				const metadata = buildMutationMetadata(targetContent, nextContent);
				const artifact = await buildWriteArtifact(
					targetDisplayPath,
					targetExisted,
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
					created: !targetExisted,
					changed: metadata.changed,
					sha256: metadata.sha256,
					summary: metadata.summary,
					artifact,
				};
			} catch (error: unknown) {
				const isEnoent = isFileNotFoundError(error);
				const staleHint = isEnoent
					? undefined
					: await getStaleReadHint(projectRoot, targetAbs, targetDisplayPath);
				const message = error instanceof Error ? error.message : String(error);
				return createToolError(
					isEnoent
						? 'Source file not found.'
						: `Failed to copy into file: ${message}${staleHint ? ` ${staleHint}` : ''}`,
					isEnoent ? 'not_found' : 'execution',
					{
						suggestion: isEnoent
							? 'Use read, ls, or tree to confirm the source file path first'
							: staleHint,
					},
				);
			}
		},
	});

	return { name: 'copy_into', tool: copyInto };
}
