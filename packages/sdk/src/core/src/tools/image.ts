const DEFAULT_MODEL_MAX_EDGE = 1024;
const DEFAULT_MODEL_JPEG_QUALITY = 70;
const DEFAULT_PASSTHROUGH_BYTES = 16 * 1024;
const JPEG_MEDIA_TYPE = 'image/jpeg';
const COMPRESSIBLE_IMAGE_TYPES = new Set([
	'image/bmp',
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
]);

type BunImageMetadata = {
	width?: number;
	height?: number;
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

export interface PreparedModelImage {
	data: Uint8Array;
	mediaType: string;
	compressed: boolean;
	width?: number;
	height?: number;
}

export interface PrepareImageOptions {
	mediaType?: string;
	maxEdge?: number;
	quality?: number;
	passthroughBytes?: number;
}

function getBunImageConstructor(): BunImageConstructor | undefined {
	return (Bun as typeof Bun & { Image?: BunImageConstructor }).Image;
}

function normalizeMediaType(mediaType: string): string {
	return mediaType.toLowerCase().split(';', 1)[0].trim();
}

/**
 * Prepares raster image bytes for model use and persistence. Supported images
 * are bounded and JPEG-encoded when that reduces size; unsupported or already
 * small encoded images pass through. Processing failures never fall back to
 * large raw raster bytes.
 */
export async function prepareImageForModel(
	bytes: Uint8Array,
	options: PrepareImageOptions = {},
): Promise<PreparedModelImage> {
	const sourceMediaType = options.mediaType ?? JPEG_MEDIA_TYPE;
	const maxEdge = options.maxEdge ?? DEFAULT_MODEL_MAX_EDGE;
	const quality = options.quality ?? DEFAULT_MODEL_JPEG_QUALITY;
	const passthroughBytes =
		options.passthroughBytes ?? DEFAULT_PASSTHROUGH_BYTES;
	if (
		!COMPRESSIBLE_IMAGE_TYPES.has(normalizeMediaType(sourceMediaType)) ||
		bytes.byteLength <= passthroughBytes
	) {
		return { data: bytes, mediaType: sourceMediaType, compressed: false };
	}

	const ImageCtor = getBunImageConstructor();
	if (!ImageCtor) {
		throw new Error(
			'Image compression is unavailable in this runtime; refusing to use raw image bytes',
		);
	}

	try {
		const image = new ImageCtor(bytes);
		const metadata = await image.metadata();
		const width = metadata.width;
		const height = metadata.height;
		if (!width || !height) {
			throw new Error('Image dimensions could not be determined');
		}

		const longestEdge = Math.max(width, height);
		const shouldResize = longestEdge > maxEdge;
		const scale = shouldResize ? maxEdge / longestEdge : 1;
		const targetWidth = Math.max(1, Math.round(width * scale));
		const targetHeight = Math.max(1, Math.round(height * scale));
		const pipeline = shouldResize
			? image.resize(targetWidth, targetHeight, {
					fit: 'inside',
					withoutEnlargement: true,
				})
			: image;
		const compressed = await pipeline.jpeg({ quality }).bytes();
		if (compressed.byteLength >= bytes.byteLength) {
			return {
				data: bytes,
				mediaType: sourceMediaType,
				compressed: false,
				width,
				height,
			};
		}

		return {
			data: compressed,
			mediaType: JPEG_MEDIA_TYPE,
			compressed: true,
			width: targetWidth,
			height: targetHeight,
		};
	} catch (error) {
		throw new Error(
			`Failed to compress image: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
