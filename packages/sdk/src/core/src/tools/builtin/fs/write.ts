import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
	buildMutationMetadata,
	buildWriteArtifact,
	resolveSafePath,
	expandTilde,
	isAbsoluteLike,
} from './util.ts';
import { rememberFileWrite } from './read-tracker.ts';
import DESCRIPTION from './write.txt' with { type: 'text' };
import {
	createToolAbortError,
	createToolError,
	type ToolResponse,
} from '../../error.ts';

export function buildWriteTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	const write = tool({
		description: DESCRIPTION,
		inputSchema: z.object({
			path: z
				.string()
				.describe(
					'Relative file path within the project. Writes outside the project are not allowed.',
				),
			content: z.string().describe('Text content to write'),
			createDirs: z.boolean().optional().default(true),
		}),
		async execute(
			{
				path,
				content,
				createDirs,
			}: {
				path: string;
				content: string;
				createDirs?: boolean;
			},
			options?: { abortSignal?: AbortSignal },
		): Promise<
			ToolResponse<{
				path: string;
				operation: 'write';
				bytes: number;
				bytesWritten: number;
				created: boolean;
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
						suggestion: 'Provide a file path to write',
					},
				);
			}

			const req = expandTilde(path);
			if (isAbsoluteLike(req)) {
				return createToolError(
					`Refusing to write outside project root: ${req}. Use a relative path within the project.`,
					'permission',
					{
						parameter: 'path',
						value: req,
						suggestion: 'Use a relative path within the project',
					},
				);
			}
			const abs = resolveSafePath(projectRoot, req);

			try {
				if (createDirs) {
					const dirPath = dirname(abs);
					await mkdir(dirPath, { recursive: true });
				}
				let existed = false;
				let oldText = '';
				try {
					oldText = await readFile(abs, 'utf-8');
					existed = true;
				} catch {}
				if (options?.abortSignal?.aborted) {
					return createToolAbortError('Write');
				}
				await writeFile(abs, content);
				await rememberFileWrite(projectRoot, abs);
				const metadata = buildMutationMetadata(oldText, content);
				const artifact = await buildWriteArtifact(
					req,
					existed,
					oldText,
					content,
				);
				return {
					ok: true,
					path: req,
					operation: 'write',
					bytes: metadata.bytesWritten,
					bytesWritten: metadata.bytesWritten,
					created: !existed,
					changed: metadata.changed,
					sha256: metadata.sha256,
					summary: metadata.summary,
					artifact,
				};
			} catch (error: unknown) {
				return createToolError(
					`Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
					'execution',
					{
						parameter: 'path',
						value: req,
					},
				);
			}
		},
	});
	return { name: 'write', tool: write };
}
