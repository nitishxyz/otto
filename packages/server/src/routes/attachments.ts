import { z } from '@hono/zod-openapi';
import { loadConfig, type OttoConfig } from '@ottocode/sdk';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import {
	basename,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
} from 'node:path';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { resolveRequestProjectRoot } from './project-context.ts';

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const ATTACHMENTS_DIR = 'attachments';
const MIME_EXTENSIONS: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/jpg': '.jpg',
	'image/gif': '.gif',
	'image/webp': '.webp',
	'image/svg+xml': '.svg',
	'image/bmp': '.bmp',
	'image/avif': '.avif',
	'application/pdf': '.pdf',
};

export type StoredAttachmentMetadata = {
	id: string;
	filename: string;
	mimeType: string;
	size: number;
	sha256: string;
	kind: 'image' | 'pdf' | 'text' | 'binary';
	sessionId?: string;
	originalPath: string;
	storageRoot?: 'project-state';
	relativePath?: string;
	createdAt: string;
};

const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const attachmentParamsSchema = z.object({
	id: z.string().openapi({
		param: { name: 'id', in: 'path' },
		description: 'Attachment ID',
	}),
});

const attachmentUploadBodySchema = z.object({
	file: z.unknown().openapi({
		type: 'string',
		format: 'binary',
		description: 'Attachment file to store',
	}),
	sessionId: z.string().optional(),
});

const attachmentMetadataResponseSchema = z.object({
	id: z.string(),
	filename: z.string(),
	mimeType: z.string(),
	size: z.number(),
	sha256: z.string(),
	kind: z.enum(['image', 'pdf', 'text', 'binary']),
	sessionId: z.string().optional(),
	originalPath: z.string(),
	storageRoot: z.literal('project-state').optional(),
	relativePath: z.string().optional(),
	createdAt: z.string(),
	originalUrl: z.string(),
	metadataUrl: z.string(),
	status: z.literal('ready'),
});

const attachmentErrorResponseSchema = z.object({
	error: z.string(),
});

const binaryAttachmentResponseSchema = z.unknown().openapi({
	type: 'string',
	format: 'binary',
	description: 'Raw attachment file bytes',
});

function sanitizeFilename(filename: string): string {
	const cleaned = basename(filename || 'attachment')
		.replace(/[<>:"|?*]/g, '_')
		.split('')
		.map((char) => (char < ' ' ? '_' : char))
		.join('');
	return cleaned.trim() || 'attachment';
}

function getAttachmentKind(mimeType: string): StoredAttachmentMetadata['kind'] {
	const normalized = mimeType.toLowerCase().split(';', 1)[0].trim();
	if (normalized.startsWith('image/')) return 'image';
	if (normalized === 'application/pdf') return 'pdf';
	if (
		normalized.startsWith('text/') ||
		normalized === 'application/json' ||
		normalized === 'application/xml' ||
		normalized === 'application/javascript' ||
		normalized === 'application/typescript'
	) {
		return 'text';
	}
	return 'binary';
}

function getOriginalStorageName(mimeType: string, filename: string): string {
	const normalized = mimeType.toLowerCase().split(';', 1)[0].trim();
	const mimeExtension = MIME_EXTENSIONS[normalized];
	if (mimeExtension) return `original${mimeExtension}`;
	const filenameExtension = extname(filename).toLowerCase();
	return filenameExtension ? `original${filenameExtension}` : 'original';
}

function attachmentDir(attachmentsDir: string, attachmentId: string): string {
	return join(attachmentsDir, attachmentId);
}

async function readMetadata(cfg: OttoConfig, attachmentId: string) {
	const metadataPath = join(
		attachmentDir(cfg.paths.attachmentsDir, attachmentId),
		'metadata.json',
	);
	const raw = await readFile(metadataPath, 'utf-8');
	return JSON.parse(raw) as StoredAttachmentMetadata;
}

function resolveOriginalFile(
	cfg: OttoConfig,
	metadata: StoredAttachmentMetadata,
): string {
	if (metadata.storageRoot !== 'project-state' || !metadata.relativePath) {
		throw new Error('Attachment metadata does not reference project state');
	}

	const stateRoot = resolve(cfg.paths.projectStateDir);
	const originalFile = resolve(stateRoot, metadata.relativePath);
	const relativeToState = relative(stateRoot, originalFile);
	if (relativeToState.startsWith('..') || isAbsolute(relativeToState)) {
		throw new Error('Attachment metadata path is outside project state');
	}
	return originalFile;
}

export function metadataResponse(metadata: StoredAttachmentMetadata) {
	return {
		...metadata,
		originalUrl: `/v1/attachments/${encodeURIComponent(metadata.id)}`,
		metadataUrl: `/v1/attachments/${encodeURIComponent(metadata.id)}/metadata`,
		status: 'ready' as const,
	};
}

export async function storeAttachmentBytes(args: {
	projectRoot: string;
	bytes: Buffer;
	filename: string;
	mimeType: string;
	sessionId?: string;
}): Promise<StoredAttachmentMetadata> {
	if (args.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
		throw new Error(
			`File too large: ${(args.bytes.byteLength / 1024 / 1024).toFixed(1)}MB. Max: ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB`,
		);
	}

	const id = `att_${crypto.randomUUID()}`;
	const filename = sanitizeFilename(args.filename);
	const mimeType = args.mimeType || 'application/octet-stream';
	const cfg = await loadConfig(args.projectRoot);
	const dir = attachmentDir(cfg.paths.attachmentsDir, id);
	await mkdir(dir, { recursive: true });

	const sha256 = createHash('sha256').update(args.bytes).digest('hex');
	const originalStorageName = getOriginalStorageName(mimeType, filename);
	const relativePath = join(ATTACHMENTS_DIR, id, originalStorageName);
	await writeFile(join(dir, originalStorageName), args.bytes);

	const metadata: StoredAttachmentMetadata = {
		id,
		filename,
		mimeType,
		size: args.bytes.byteLength,
		sha256,
		kind: getAttachmentKind(mimeType),
		...(args.sessionId ? { sessionId: args.sessionId } : {}),
		originalPath: relativePath,
		storageRoot: 'project-state',
		relativePath,
		createdAt: new Date().toISOString(),
	};
	await writeFile(
		join(dir, 'metadata.json'),
		`${JSON.stringify(metadata, null, 2)}\n`,
	);
	return metadata;
}

export function registerAttachmentRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/attachments',
			tags: ['attachments'],
			operationId: 'uploadAttachment',
			summary: 'Upload an attachment',
			description:
				'Store an attachment file under the configured project state directory. Multipart uploads are represented in OpenAPI with a binary Zod schema so generated clients can expose the endpoint.',
			request: {
				query: projectQuerySchema,
				body: {
					required: true,
					content: {
						'multipart/form-data': {
							schema: attachmentUploadBodySchema,
						},
					},
				},
			},
			responses: {
				'201': {
					description: 'Attachment stored',
					content: {
						'application/json': {
							schema: attachmentMetadataResponseSchema,
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: attachmentErrorResponseSchema,
						},
					},
				},
				'413': {
					description: 'Attachment too large',
					content: {
						'application/json': {
							schema: attachmentErrorResponseSchema,
						},
					},
				},
				'500': {
					description: 'Upload failed',
					content: {
						'application/json': {
							schema: attachmentErrorResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				const cfg = await loadConfig(projectRoot);
				const form = await c.req.formData();
				const value = form.get('file');
				if (!(value instanceof File)) {
					return c.json({ error: 'Missing file field' }, 400);
				}
				if (value.size > MAX_ATTACHMENT_BYTES) {
					return c.json(
						{
							error: `File too large: ${(value.size / 1024 / 1024).toFixed(1)}MB. Max: ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB`,
						},
						413,
					);
				}

				const bytes = Buffer.from(await value.arrayBuffer());
				const sessionIdValue = form.get('sessionId');
				const metadata = await storeAttachmentBytes({
					projectRoot: cfg.projectRoot,
					bytes,
					filename: value.name,
					mimeType: value.type || 'application/octet-stream',
					sessionId:
						typeof sessionIdValue === 'string' && sessionIdValue
							? sessionIdValue
							: undefined,
				});

				return c.json(metadataResponse(metadata), 201);
			} catch (error) {
				return c.json(
					{
						error:
							error instanceof Error
								? error.message
								: 'Failed to upload attachment',
					},
					500,
				);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/attachments/{id}/metadata',
			tags: ['attachments'],
			operationId: 'getAttachmentMetadata',
			summary: 'Get attachment metadata',
			request: {
				params: attachmentParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'Attachment metadata',
					content: {
						'application/json': {
							schema: attachmentMetadataResponseSchema,
						},
					},
				},
				'404': {
					description: 'Attachment not found',
					content: {
						'application/json': {
							schema: attachmentErrorResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				const cfg = await loadConfig(projectRoot);
				const metadata = await readMetadata(cfg, c.req.param('id'));
				return c.json(metadataResponse(metadata));
			} catch {
				return c.json({ error: 'Attachment not found' }, 404);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/attachments/{id}',
			tags: ['attachments'],
			operationId: 'getAttachment',
			summary: 'Get raw attachment bytes',
			description:
				'Returns the original attachment file. This binary response is represented in OpenAPI with a binary Zod schema; consumers may still prefer URL-based rendering for images/PDFs.',
			request: {
				params: attachmentParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'Raw attachment bytes',
					content: {
						'application/octet-stream': {
							schema: binaryAttachmentResponseSchema,
						},
					},
				},
				'404': {
					description: 'Attachment not found',
					content: {
						'application/json': {
							schema: attachmentErrorResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = await resolveRequestProjectRoot(c);
				const cfg = await loadConfig(projectRoot);
				const metadata = await readMetadata(cfg, c.req.param('id'));
				const originalFile = resolveOriginalFile(cfg, metadata);
				await stat(originalFile);
				const file = Bun.file(originalFile, { type: metadata.mimeType });
				return new Response(file, {
					headers: {
						'Content-Type': metadata.mimeType,
						'Content-Length': String(metadata.size),
						'Content-Disposition': `inline; filename="${metadata.filename.replace(/"/g, '')}"`,
					},
				});
			} catch {
				return c.json({ error: 'Attachment not found' }, 404);
			}
		},
	);
}
