import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { createToolError, type ToolResponse } from '../../error.ts';
import { expandTilde, isAbsoluteLike, resolveSafePath } from './util.ts';
import DESCRIPTION from './read-image.txt' with { type: 'text' };

type BunImageMetadata = {
	width?: number;
	height?: number;
	format?: string;
};

type BunImagePipeline = {
	metadata(): Promise<BunImageMetadata>;
	resize(
		width: number,
		height?: number,
		options?: {
			fit?: 'inside';
			withoutEnlargement?: boolean;
		},
	): BunImagePipeline;
	jpeg(options?: { quality?: number }): BunImagePipeline;
	bytes(): Promise<Uint8Array>;
};

type BunImageConstructor = new (
	input: string | ArrayBuffer | Uint8Array | Blob,
) => BunImagePipeline;

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

type ReadImageResult = {
	ok: true;
	path: string;
	mediaType: string;
	data: string;
	size: number;
	transmittedSize: number;
	sha256: string;
	compressed: boolean;
	width?: number;
	height?: number;
};

type PreparedImage = {
	data: Uint8Array;
	mediaType: string;
	width?: number;
	height?: number;
	compressed: boolean;
};

type ReadImageInput = {
	path: string;
	maxEdge?: number;
	quality?: number;
	maxBytes?: number;
};

const DEFAULT_MAX_EDGE = 1568;
const DEFAULT_QUALITY = 82;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const JPEG_MEDIA_TYPE = 'image/jpeg';
const SUPPORTED_IMAGE_TYPES = new Set([
	'image/bmp',
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/webp',
]);
const COMPRESSIBLE_IMAGE_TYPES = new Set([
	'image/bmp',
	'image/jpeg',
	'image/png',
	'image/webp',
]);
const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
	'.bmp': 'image/bmp',
	'.gif': 'image/gif',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
};

function getBunImageConstructor(): BunImageConstructor | undefined {
	return (Bun as typeof Bun & { Image?: BunImageConstructor }).Image;
}

function toJsonValue(value: unknown): JsonValue {
	if (value === undefined) return null;
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		return String(value);
	}
}

function normalizeMediaType(mediaType: string | undefined): string | undefined {
	const normalized = mediaType?.toLowerCase().split(';', 1)[0].trim();
	return normalized === 'image/jpg' ? JPEG_MEDIA_TYPE : normalized;
}

function detectMediaType(
	filePath: string,
	data: Uint8Array,
): string | undefined {
	if (
		data.length >= 8 &&
		data[0] === 0x89 &&
		data[1] === 0x50 &&
		data[2] === 0x4e &&
		data[3] === 0x47
	) {
		return 'image/png';
	}
	if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8) {
		return JPEG_MEDIA_TYPE;
	}
	if (
		data.length >= 12 &&
		data[0] === 0x52 &&
		data[1] === 0x49 &&
		data[2] === 0x46 &&
		data[3] === 0x46 &&
		data[8] === 0x57 &&
		data[9] === 0x45 &&
		data[10] === 0x42 &&
		data[11] === 0x50
	) {
		return 'image/webp';
	}
	if (
		data.length >= 6 &&
		data[0] === 0x47 &&
		data[1] === 0x49 &&
		data[2] === 0x46
	) {
		return 'image/gif';
	}
	if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d) {
		return 'image/bmp';
	}
	return normalizeMediaType(
		MEDIA_TYPE_BY_EXTENSION[extname(filePath).toLowerCase()],
	);
}

async function prepareImage(
	input: Uint8Array,
	mediaType: string,
	options: Required<Pick<ReadImageInput, 'maxEdge' | 'quality'>>,
): Promise<PreparedImage> {
	const ImageConstructor = getBunImageConstructor();
	if (!ImageConstructor || !COMPRESSIBLE_IMAGE_TYPES.has(mediaType)) {
		return { data: input, mediaType, compressed: false };
	}

	try {
		const image = new ImageConstructor(input);
		const metadata = await image.metadata();
		const width = metadata.width ?? 0;
		const height = metadata.height ?? 0;
		if (width <= 0 || height <= 0) {
			return { data: input, mediaType, compressed: false };
		}

		const pipeline =
			width > options.maxEdge || height > options.maxEdge
				? image.resize(options.maxEdge, options.maxEdge, {
						fit: 'inside',
						withoutEnlargement: true,
					})
				: image;
		const output = await pipeline.jpeg({ quality: options.quality }).bytes();

		if (output.byteLength >= input.byteLength) {
			return { data: input, mediaType, width, height, compressed: false };
		}

		return {
			data: output,
			mediaType: JPEG_MEDIA_TYPE,
			width,
			height,
			compressed: true,
		};
	} catch {
		return { data: input, mediaType, compressed: false };
	}
}

/**
 * Builds the read_image tool, which loads local image files and returns image
 * content that vision-capable language models can inspect.
 */
export function buildReadImageTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	const readImage = tool({
		description: DESCRIPTION,
		inputSchema: z.object({
			path: z
				.string()
				.describe(
					"Image path. Relative to project root by default; absolute ('/...') and home ('~/...') paths are allowed.",
				),
			maxEdge: z
				.number()
				.int()
				.min(1)
				.max(4096)
				.optional()
				.describe(
					'Maximum width or height for model submission. Defaults to 1568.',
				),
			quality: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe('JPEG quality when compression is used. Defaults to 82.'),
			maxBytes: z
				.number()
				.int()
				.min(1024)
				.max(20 * 1024 * 1024)
				.optional()
				.describe(
					'Maximum transmitted image bytes after compression. Defaults to 4 MiB.',
				),
		}),
		async execute({
			path,
			maxEdge = DEFAULT_MAX_EDGE,
			quality = DEFAULT_QUALITY,
			maxBytes = DEFAULT_MAX_BYTES,
		}: ReadImageInput): Promise<ToolResponse<ReadImageResult>> {
			if (!path || path.trim().length === 0) {
				return createToolError(
					'Missing required parameter: path',
					'validation',
					{
						parameter: 'path',
						value: path,
						suggestion: 'Provide an image file path to read',
					},
				);
			}

			const req = expandTilde(path);
			let abs: string;
			try {
				abs = isAbsoluteLike(req) ? req : resolveSafePath(projectRoot, req);
			} catch (error) {
				return createToolError(
					`Invalid image path: ${error instanceof Error ? error.message : String(error)}`,
					'validation',
					{ parameter: 'path', value: req },
				);
			}

			try {
				const input = await readFile(abs);
				if (input.byteLength === 0) {
					return createToolError('Image file is empty', 'validation', {
						parameter: 'path',
						value: req,
					});
				}

				const mediaType = detectMediaType(abs, input);
				if (!mediaType || !SUPPORTED_IMAGE_TYPES.has(mediaType)) {
					return createToolError(
						`Unsupported image type: ${mediaType ?? 'unknown'}`,
						'validation',
						{
							parameter: 'path',
							value: req,
							suggestion:
								'Use PNG, JPEG, WebP, GIF, or BMP images with read_image',
						},
					);
				}

				const prepared = await prepareImage(input, mediaType, {
					maxEdge,
					quality,
				});
				if (prepared.data.byteLength > maxBytes) {
					return createToolError(
						`Image is too large after compression: ${prepared.data.byteLength} bytes`,
						'validation',
						{
							parameter: 'maxBytes',
							value: maxBytes,
							suggestion:
								'Increase maxBytes or lower maxEdge/quality for this image',
						},
					);
				}

				const result: ReadImageResult = {
					ok: true,
					path: req,
					mediaType: prepared.mediaType,
					data: Buffer.from(prepared.data).toString('base64'),
					size: input.byteLength,
					transmittedSize: prepared.data.byteLength,
					sha256: createHash('sha256').update(input).digest('hex'),
					compressed: prepared.compressed,
				};
				if (prepared.width) result.width = prepared.width;
				if (prepared.height) result.height = prepared.height;
				return result;
			} catch (error) {
				const isEnoent =
					error &&
					typeof error === 'object' &&
					'code' in error &&
					error.code === 'ENOENT';
				return createToolError(
					isEnoent
						? `Image not found: ${req}`
						: `Failed to read image: ${error instanceof Error ? error.message : String(error)}`,
					isEnoent ? 'not_found' : 'execution',
					{
						parameter: 'path',
						value: req,
						suggestion: isEnoent
							? 'Use ls or tree to find available images'
							: undefined,
					},
				);
			}
		},
		toModelOutput({ output }) {
			const maybeResult = output as Partial<ReadImageResult>;
			if (
				maybeResult.ok !== true ||
				typeof maybeResult.data !== 'string' ||
				typeof maybeResult.mediaType !== 'string'
			) {
				return { type: 'json', value: toJsonValue(output) };
			}

			const dimensions =
				typeof maybeResult.width === 'number' &&
				typeof maybeResult.height === 'number'
					? `, ${maybeResult.width}x${maybeResult.height}`
					: '';
			return {
				type: 'content',
				value: [
					{
						type: 'text',
						text: `Image read from ${maybeResult.path} (${maybeResult.mediaType}${dimensions}, ${maybeResult.transmittedSize} bytes). Inspect the following image content.`,
					},
					{
						type: 'image-data',
						data: maybeResult.data,
						mediaType: maybeResult.mediaType,
					},
				],
			};
		},
	});
	return { name: 'read_image', tool: readImage };
}
