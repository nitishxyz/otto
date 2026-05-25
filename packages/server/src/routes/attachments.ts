import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Hono } from 'hono';
import { loadConfig } from '@ottocode/sdk';

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const ATTACHMENTS_DIR = '.otto/attachments';
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

type StoredAttachmentMetadata = {
	id: string;
	filename: string;
	mimeType: string;
	size: number;
	sha256: string;
	kind: 'image' | 'pdf' | 'text' | 'binary';
	sessionId?: string;
	originalPath: string;
	createdAt: string;
};

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

function attachmentDir(projectRoot: string, attachmentId: string): string {
	return join(projectRoot, ATTACHMENTS_DIR, attachmentId);
}

async function readMetadata(projectRoot: string, attachmentId: string) {
	const metadataPath = join(
		attachmentDir(projectRoot, attachmentId),
		'metadata.json',
	);
	const raw = await readFile(metadataPath, 'utf-8');
	return JSON.parse(raw) as StoredAttachmentMetadata;
}

function metadataResponse(metadata: StoredAttachmentMetadata) {
	return {
		...metadata,
		originalUrl: `/v1/attachments/${encodeURIComponent(metadata.id)}`,
		metadataUrl: `/v1/attachments/${encodeURIComponent(metadata.id)}/metadata`,
		status: 'ready' as const,
	};
}

export function registerAttachmentRoutes(app: Hono) {
	app.post('/v1/attachments', async (c) => {
		try {
			const projectRoot = c.req.query('project') || process.cwd();
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

			const id = `att_${crypto.randomUUID()}`;
			const filename = sanitizeFilename(value.name);
			const mimeType = value.type || 'application/octet-stream';
			const dir = attachmentDir(cfg.projectRoot, id);
			await mkdir(dir, { recursive: true });

			const bytes = Buffer.from(await value.arrayBuffer());
			const sha256 = createHash('sha256').update(bytes).digest('hex');
			const originalStorageName = getOriginalStorageName(mimeType, filename);
			const originalPath = join(ATTACHMENTS_DIR, id, originalStorageName);
			await writeFile(join(dir, originalStorageName), bytes);

			const sessionIdValue = form.get('sessionId');
			const metadata: StoredAttachmentMetadata = {
				id,
				filename,
				mimeType,
				size: bytes.byteLength,
				sha256,
				kind: getAttachmentKind(mimeType),
				...(typeof sessionIdValue === 'string' && sessionIdValue
					? { sessionId: sessionIdValue }
					: {}),
				originalPath,
				createdAt: new Date().toISOString(),
			};
			await writeFile(
				join(dir, 'metadata.json'),
				`${JSON.stringify(metadata, null, 2)}\n`,
			);

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
	});

	app.get('/v1/attachments/:id/metadata', async (c) => {
		try {
			const projectRoot = c.req.query('project') || process.cwd();
			const cfg = await loadConfig(projectRoot);
			const metadata = await readMetadata(cfg.projectRoot, c.req.param('id'));
			return c.json(metadataResponse(metadata));
		} catch {
			return c.json({ error: 'Attachment not found' }, 404);
		}
	});

	app.get('/v1/attachments/:id', async (c) => {
		try {
			const projectRoot = c.req.query('project') || process.cwd();
			const cfg = await loadConfig(projectRoot);
			const metadata = await readMetadata(cfg.projectRoot, c.req.param('id'));
			const originalFile = join(cfg.projectRoot, metadata.originalPath);
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
	});
}

export type { StoredAttachmentMetadata };
