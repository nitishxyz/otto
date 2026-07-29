const DEFAULT_MODEL_MAX_EDGE = 1024;
const DEFAULT_MODEL_JPEG_QUALITY = 70;

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

export interface ModelScreenshot {
	data: Uint8Array;
	mediaType: string;
	compressed: boolean;
	width?: number;
	height?: number;
}

export interface PrepareScreenshotOptions {
	/** Media type of the captured bytes. Used when the image is passed through. */
	mediaType?: string;
	maxEdge?: number;
	quality?: number;
}

function getBunImageConstructor(): BunImageConstructor | undefined {
	return (Bun as typeof Bun & { Image?: BunImageConstructor }).Image;
}

/**
 * Downscales and re-encodes a screenshot so vision models receive a payload
 * small enough to transmit, falling back to the original bytes when Bun.Image
 * is unavailable or the image cannot be decoded.
 */
export async function prepareScreenshotForModel(
	bytes: Uint8Array,
	options: PrepareScreenshotOptions = {},
): Promise<ModelScreenshot> {
	const sourceMediaType = options.mediaType ?? 'image/jpeg';
	const maxEdge = options.maxEdge ?? DEFAULT_MODEL_MAX_EDGE;
	const quality = options.quality ?? DEFAULT_MODEL_JPEG_QUALITY;
	const ImageCtor = getBunImageConstructor();
	if (!ImageCtor) {
		return { data: bytes, mediaType: sourceMediaType, compressed: false };
	}

	try {
		const image = new ImageCtor(bytes);
		const metadata = await image.metadata();
		const width = metadata.width;
		const height = metadata.height;
		if (!width || !height) {
			return { data: bytes, mediaType: sourceMediaType, compressed: false };
		}

		const longestEdge = Math.max(width, height);
		if (longestEdge <= maxEdge) {
			return {
				data: bytes,
				mediaType: sourceMediaType,
				compressed: false,
				width,
				height,
			};
		}

		const scale = maxEdge / longestEdge;
		const targetWidth = Math.max(1, Math.round(width * scale));
		const targetHeight = Math.max(1, Math.round(height * scale));
		const compressed = await image
			.resize(targetWidth, targetHeight, {
				fit: 'inside',
				withoutEnlargement: true,
			})
			.jpeg({ quality })
			.bytes();

		return {
			data: compressed,
			mediaType: 'image/jpeg',
			compressed: true,
			width: targetWidth,
			height: targetHeight,
		};
	} catch {
		return { data: bytes, mediaType: sourceMediaType, compressed: false };
	}
}
