import { readFile, writeFile } from 'node:fs/promises';
import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import DESCRIPTION from './edit.txt' with { type: 'text' };
import {
	buildMutationMetadata,
	buildWriteArtifact,
	isAbsoluteLike,
	resolveSafePath,
} from './util.ts';
import { applyStringEdit } from './edit-shared.ts';
import { getStaleReadHint, rememberFileWrite } from './read-tracker.ts';
import {
	createToolAbortError,
	createToolError,
	type ToolResponse,
} from '../../error.ts';

export function buildEditTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	const edit = tool({
		description: DESCRIPTION,
		inputSchema: z.object({
			path: z
				.string()
				.describe(
					'Relative file path within the project. Absolute paths are not allowed.',
				),
			oldString: z
				.string()
				.describe(
					'Text to replace. Exact matches are preferred; unique whole-line whitespace-normalized matches are tolerated.',
				),
			newString: z.string().describe('Replacement text'),
			replaceAll: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					'Replace every matching occurrence instead of requiring a unique match',
				),
		}),
		async execute(
			{
				path,
				oldString,
				newString,
				replaceAll = false,
			}: {
				path: string;
				oldString: string;
				newString: string;
				replaceAll?: boolean;
			},
			options?: { abortSignal?: AbortSignal },
		): Promise<
			ToolResponse<{
				path: string;
				operation: 'edit';
				occurrences: number;
				bytes: number;
				bytesWritten: number;
				changed: boolean;
				sha256: string;
				summary: { files: number; additions: number; deletions: number };
				artifact: unknown;
			}>
		> {
			if (!path || path.trim().length === 0) {
				return createToolError(
					'Missing required parameter: path',
					'validation',
					{
						parameter: 'path',
						value: path,
						suggestion: 'Provide a relative file path to edit',
					},
				);
			}
			if (isAbsoluteLike(path)) {
				return createToolError(
					`Refusing to edit outside project root: ${path}`,
					'permission',
					{
						parameter: 'path',
						value: path,
						suggestion: 'Use a relative path within the project',
					},
				);
			}

			const abs = resolveSafePath(projectRoot, path);
			try {
				const original = await readFile(abs, 'utf-8');
				const updated = applyStringEdit(
					original,
					oldString,
					newString,
					replaceAll,
				);
				if (updated.content === original) {
					return createToolError('No changes applied.', 'validation', {
						suggestion:
							'Adjust oldString/newString so the file content actually changes',
					});
				}

				if (options?.abortSignal?.aborted) {
					return createToolAbortError('Edit');
				}
				await writeFile(abs, updated.content, 'utf-8');
				await rememberFileWrite(projectRoot, abs);
				const metadata = buildMutationMetadata(original, updated.content);
				const artifact = await buildWriteArtifact(
					path,
					true,
					original,
					updated.content,
				);
				return {
					ok: true,
					path,
					operation: 'edit',
					occurrences: updated.occurrences,
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
				const staleHint = isEnoent
					? undefined
					: await getStaleReadHint(projectRoot, abs, path);
				const message = error instanceof Error ? error.message : String(error);
				return createToolError(
					isEnoent
						? `File not found: ${path}`
						: `Failed to edit file: ${message}${staleHint ? ` ${staleHint}` : ''}`,
					isEnoent ? 'not_found' : 'execution',
					{
						parameter: 'path',
						value: path,
						suggestion: isEnoent
							? 'Use read or ls to confirm the file path first'
							: staleHint,
					},
				);
			}
		},
	});

	return { name: 'edit', tool: edit };
}
