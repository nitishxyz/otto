import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	getStoredAttachment,
	MAX_ATTACHMENT_BYTES,
	readAttachmentMetadata,
	storedAttachmentMetadataSchema,
	storeAttachmentBytes,
	type StoredAttachmentMetadata,
} from '../runtime/attachments/service.ts';
import { resolveRequestProjectRoot } from './project-context.ts';

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

const attachmentMetadataResponseSchema = storedAttachmentMetadataSchema.extend({
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
	description: 'Stored attachment file bytes',
});

function getContentDisposition(filename: string): string {
	const fallback =
		filename.replace(/[^\x20-\x7e]|["\\]/g, '_').trim() || 'attachment';
	const encoded = encodeURIComponent(filename).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function metadataResponse(metadata: StoredAttachmentMetadata) {
	return {
		...metadata,
		originalUrl: `/v1/attachments/${encodeURIComponent(metadata.id)}`,
		metadataUrl: `/v1/attachments/${encodeURIComponent(metadata.id)}/metadata`,
		status: 'ready' as const,
	};
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
				'Store an attachment file under the configured project state directory. Supported raster images are re-encoded before storage, and the source image bytes are not retained. Multipart uploads are represented in OpenAPI with a binary Zod schema so generated clients can expose the endpoint.',
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
					projectRoot,
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
				const metadata = await readAttachmentMetadata({
					projectRoot,
					attachmentId: c.req.param('id'),
				});
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
			summary: 'Get stored attachment bytes',
			description:
				'Returns the stored attachment representation. Raster images may be re-encoded and downscaled from the uploaded source. This binary response is represented in OpenAPI with a binary Zod schema; consumers may still prefer URL-based rendering for images/PDFs.',
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
				const { metadata, path } = await getStoredAttachment({
					projectRoot,
					attachmentId: c.req.param('id'),
				});
				const file = Bun.file(path, { type: metadata.mimeType });
				return new Response(file, {
					headers: {
						'Content-Type': metadata.mimeType,
						'Content-Length': String(metadata.size),
						'Content-Disposition': getContentDisposition(metadata.filename),
					},
				});
			} catch {
				return c.json({ error: 'Attachment not found' }, 404);
			}
		},
	);
}
