import { z } from '@hono/zod-openapi';
import { loadConfig } from '@ottocode/sdk';
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
import { prepareImageBytes } from '../message/image-compression.ts';

export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const ATTACHMENTS_DIR = 'attachments';
const ATTACHMENT_ID_PATTERN = /^att_[A-Za-z0-9_-]+$/;
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

export const storedAttachmentMetadataSchema = z.object({
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
});

export type StoredAttachmentMetadata = z.infer<
	typeof storedAttachmentMetadataSchema
>;

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

function requireAttachmentId(attachmentId: string): void {
	if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) {
		throw new Error('Invalid attachment ID');
	}
}

function resolveConfinedPath(root: string, candidate: string): string {
	const resolvedRoot = resolve(root);
	const resolvedCandidate = resolve(candidate);
	const relativeToRoot = relative(resolvedRoot, resolvedCandidate);
	if (relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
		throw new Error('Attachment path is outside its storage directory');
	}
	return resolvedCandidate;
}

export async function readAttachmentMetadata(args: {
	projectRoot: string;
	attachmentId: string;
}): Promise<StoredAttachmentMetadata> {
	requireAttachmentId(args.attachmentId);
	const cfg = await loadConfig(args.projectRoot);
	const metadataPath = join(
		cfg.paths.attachmentsDir,
		args.attachmentId,
		'metadata.json',
	);
	const raw = await readFile(metadataPath, 'utf8');
	const metadata = storedAttachmentMetadataSchema.parse(JSON.parse(raw));
	if (metadata.id !== args.attachmentId) {
		throw new Error('Attachment metadata ID does not match its storage path');
	}
	return metadata;
}

export async function getStoredAttachment(args: {
	projectRoot: string;
	attachmentId: string;
}): Promise<{ metadata: StoredAttachmentMetadata; path: string }> {
	const metadata = await readAttachmentMetadata(args);
	if (metadata.storageRoot !== 'project-state' || !metadata.relativePath) {
		throw new Error('Attachment metadata does not reference project state');
	}

	const cfg = await loadConfig(args.projectRoot);
	const statePath = resolveConfinedPath(
		cfg.paths.projectStateDir,
		join(cfg.paths.projectStateDir, metadata.relativePath),
	);
	const path = resolveConfinedPath(
		join(cfg.paths.attachmentsDir, args.attachmentId),
		statePath,
	);
	await stat(path);
	return { metadata, path };
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
	const sourceMimeType = args.mimeType || 'application/octet-stream';
	const prepared = await prepareImageBytes(args.bytes, sourceMimeType);
	const storedBytes = Buffer.from(prepared.bytes);
	const mimeType = prepared.mediaType;
	const cfg = await loadConfig(args.projectRoot);
	const dir = join(cfg.paths.attachmentsDir, id);
	await mkdir(dir, { recursive: true });

	const sha256 = createHash('sha256').update(storedBytes).digest('hex');
	const originalStorageName = getOriginalStorageName(mimeType, filename);
	const relativePath = join(ATTACHMENTS_DIR, id, originalStorageName);
	await writeFile(join(dir, originalStorageName), storedBytes);

	const metadata: StoredAttachmentMetadata = {
		id,
		filename,
		mimeType,
		size: storedBytes.byteLength,
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
