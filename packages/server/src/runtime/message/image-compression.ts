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

export type ImageAttachmentPayload = {
	data: string;
	mediaType: string;
	name?: string;
	attachmentId?: string;
	original?: AttachmentOriginalMetadata;
	compression?: ImageCompressionMetadata;
};

type AttachmentOriginalMetadata = {
	filename?: string;
	size?: number;
	sha256?: string;
	mimeType?: string;
};

export type ImageCompressionMetadata = {
	compressed: boolean;
	originalBytes: number;
	compressedBytes: number;
	originalMediaType: string;
	maxEdge: number;
	quality: number;
};

export type FileAttachmentPayload = {
	type: 'image' | 'pdf' | 'text' | 'binary';
	name: string;
	data?: string;
	mediaType: string;
	compression?: ImageCompressionMetadata;
	textContent?: string;
	attachmentId?: string;
	original?: AttachmentOriginalMetadata;
};

type CompressImageOptions = {
	maxEdge?: number;
	quality?: number;
};

const COMPRESSIBLE_IMAGE_TYPES = new Set([
	'image/bmp',
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/webp',
]);
const DEFAULT_MAX_EDGE = 1568;
const DEFAULT_QUALITY = 82;
const JPEG_MEDIA_TYPE = 'image/jpeg';

function getNormalizedMediaType(mediaType: string): string {
	return mediaType.toLowerCase().split(';', 1)[0].trim();
}

function getBunImageConstructor(): BunImageConstructor | undefined {
	return (Bun as typeof Bun & { Image?: BunImageConstructor }).Image;
}

async function compressImageAttachment(
	attachment: ImageAttachmentPayload,
	options: Required<CompressImageOptions>,
): Promise<ImageAttachmentPayload> {
	const mediaType = getNormalizedMediaType(attachment.mediaType);
	if (!COMPRESSIBLE_IMAGE_TYPES.has(mediaType)) {
		return attachment;
	}

	const ImageConstructor = getBunImageConstructor();
	if (!ImageConstructor) {
		return attachment;
	}

	try {
		const input = Buffer.from(attachment.data, 'base64');
		if (input.byteLength === 0) {
			return attachment;
		}

		const image = new ImageConstructor(input);
		const metadata = await image.metadata();
		const width = metadata.width ?? 0;
		const height = metadata.height ?? 0;
		if (width <= 0 || height <= 0) {
			return attachment;
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
			return attachment;
		}

		return {
			...attachment,
			data: Buffer.from(output).toString('base64'),
			mediaType: JPEG_MEDIA_TYPE,
			compression: {
				compressed: true,
				originalBytes: input.byteLength,
				compressedBytes: output.byteLength,
				originalMediaType: attachment.mediaType,
				maxEdge: options.maxEdge,
				quality: options.quality,
			},
		};
	} catch {
		return attachment;
	}
}

/**
 * Compresses user-supplied image attachments with Bun.Image before persistence
 * and model submission. Attachments are returned unchanged if compression fails
 * or would increase payload size.
 */
export async function compressImageAttachments(
	attachments: ImageAttachmentPayload[] | undefined,
	options: CompressImageOptions = {},
): Promise<ImageAttachmentPayload[] | undefined> {
	if (!attachments?.length) {
		return attachments;
	}

	const resolvedOptions = {
		maxEdge: options.maxEdge ?? DEFAULT_MAX_EDGE,
		quality: options.quality ?? DEFAULT_QUALITY,
	};

	return Promise.all(
		attachments.map((attachment) =>
			compressImageAttachment(attachment, resolvedOptions),
		),
	);
}

/**
 * Compresses image entries in mixed file attachments while preserving PDFs and
 * text files unchanged.
 */
export async function compressFileImageAttachments(
	attachments: FileAttachmentPayload[] | undefined,
	options: CompressImageOptions = {},
): Promise<FileAttachmentPayload[] | undefined> {
	if (!attachments?.length) {
		return attachments;
	}

	const resolvedOptions = {
		maxEdge: options.maxEdge ?? DEFAULT_MAX_EDGE,
		quality: options.quality ?? DEFAULT_QUALITY,
	};

	return Promise.all(
		attachments.map(async (attachment) => {
			if (attachment.type !== 'image' || !attachment.data) {
				return attachment;
			}

			const compressed = await compressImageAttachment(
				{ data: attachment.data, mediaType: attachment.mediaType },
				resolvedOptions,
			);
			if (compressed === attachment) {
				return attachment;
			}

			return {
				...attachment,
				data: compressed.data,
				mediaType: compressed.mediaType,
				compression: compressed.compression,
			};
		}),
	);
}
