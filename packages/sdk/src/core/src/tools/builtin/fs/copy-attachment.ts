import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { createToolError, type ToolResponse } from '../../error.ts';
import { expandTilde, isAbsoluteLike, resolveSafePath } from './util.ts';
import { rememberFileWrite } from './read-tracker.ts';
import DESCRIPTION from './copy-attachment.txt' with { type: 'text' };

type AttachmentMetadata = {
	id: string;
	filename: string;
	mimeType: string;
	size: number;
	sha256: string;
	kind: 'image' | 'pdf' | 'text' | 'binary';
	originalPath: string;
	createdAt: string;
};

const ATTACHMENTS_DIR = '.otto/attachments';
const MIME_EXTENSIONS: Record<string, string[]> = {
	'image/png': ['.png'],
	'image/jpeg': ['.jpg', '.jpeg'],
	'image/jpg': ['.jpg', '.jpeg'],
	'image/gif': ['.gif'],
	'image/webp': ['.webp'],
	'image/svg+xml': ['.svg'],
	'image/bmp': ['.bmp'],
	'image/avif': ['.avif'],
	'application/pdf': ['.pdf'],
};

function getExpectedExtensions(mimeType: string): string[] {
	return MIME_EXTENSIONS[mimeType.toLowerCase().split(';', 1)[0].trim()] ?? [];
}

function replaceExtension(path: string, extension: string): string {
	return extname(path)
		? path.replace(/\.[^/.]*$/, extension)
		: `${path}${extension}`;
}

async function readAttachmentMetadata(
	projectRoot: string,
	attachmentId: string,
): Promise<AttachmentMetadata> {
	const metadataPath = join(
		projectRoot,
		ATTACHMENTS_DIR,
		attachmentId,
		'metadata.json',
	);
	const raw = await readFile(metadataPath, 'utf-8');
	return JSON.parse(raw) as AttachmentMetadata;
}

export function buildCopyAttachmentTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	const copyAttachment = tool({
		description: DESCRIPTION,
		inputSchema: z.object({
			attachmentId: z
				.string()
				.describe('Attachment id from the current chat, e.g. att_...'),
			targetPath: z
				.string()
				.describe('Project-relative destination path for the original file.'),
			overwrite: z
				.boolean()
				.optional()
				.default(false)
				.describe('Overwrite the target path if it already exists.'),
			createDirs: z
				.boolean()
				.optional()
				.default(true)
				.describe('Create parent directories for the target path.'),
		}),
		async execute({
			attachmentId,
			targetPath,
			overwrite,
			createDirs,
		}: {
			attachmentId: string;
			targetPath: string;
			overwrite?: boolean;
			createDirs?: boolean;
		}): Promise<
			ToolResponse<{
				attachmentId: string;
				path: string;
				filename: string;
				mimeType: string;
				bytes: number;
				sha256: string;
				created: boolean;
				requestedPath?: string;
				extensionAdjusted?: boolean;
			}>
		> {
			if (!attachmentId || attachmentId.trim().length === 0) {
				return createToolError(
					'Missing required parameter: attachmentId',
					'validation',
					{ parameter: 'attachmentId' },
				);
			}
			if (!targetPath || targetPath.trim().length === 0) {
				return createToolError(
					'Missing required parameter: targetPath',
					'validation',
					{ parameter: 'targetPath' },
				);
			}

			const requestedPath = expandTilde(targetPath);
			if (isAbsoluteLike(requestedPath)) {
				return createToolError(
					`Refusing to copy outside project root: ${requestedPath}. Use a relative path within the project.`,
					'permission',
					{
						parameter: 'targetPath',
						value: requestedPath,
						suggestion: 'Use a relative path within the project',
					},
				);
			}

			try {
				const metadata = await readAttachmentMetadata(
					projectRoot,
					attachmentId,
				);
				const source = join(projectRoot, metadata.originalPath);
				const expectedExtensions = getExpectedExtensions(metadata.mimeType);
				const targetExtension = extname(requestedPath).toLowerCase();
				const preferredExtension = expectedExtensions[0];
				const req =
					preferredExtension && !expectedExtensions.includes(targetExtension)
						? replaceExtension(requestedPath, preferredExtension)
						: requestedPath;
				const extensionAdjusted = req !== requestedPath;
				const target = resolveSafePath(projectRoot, req);
				try {
					await stat(target);
					if (!overwrite) {
						return createToolError(
							`Target file already exists: ${req}`,
							'validation',
							{
								parameter: 'targetPath',
								value: req,
								suggestion:
									'Choose a different target path or set overwrite to true',
							},
						);
					}
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				}

				if (createDirs) {
					await mkdir(dirname(target), { recursive: true });
				}
				await copyFile(source, target);
				await rememberFileWrite(projectRoot, target);
				const bytes = await readFile(target);
				const sha256 = createHash('sha256').update(bytes).digest('hex');
				return {
					ok: true,
					attachmentId,
					path: req,
					...(extensionAdjusted ? { requestedPath } : {}),
					extensionAdjusted,
					filename: metadata.filename,
					mimeType: metadata.mimeType,
					bytes: bytes.byteLength,
					sha256,
					created: true,
				};
			} catch (error) {
				return createToolError(
					`Failed to copy attachment: ${error instanceof Error ? error.message : String(error)}`,
					'execution',
					{ parameter: 'attachmentId', value: attachmentId },
				);
			}
		},
	});
	return { name: 'copy_attachment_to_project', tool: copyAttachment };
}
