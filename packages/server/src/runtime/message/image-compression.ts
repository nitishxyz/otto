import { prepareImageForModel } from '@ottocode/sdk/image';

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

export type PreparedImageBytes = {
	bytes: Uint8Array;
	mediaType: string;
	compression?: ImageCompressionMetadata;
};

const DEFAULT_MAX_EDGE = 1568;
const DEFAULT_QUALITY = 82;
const ENCODED_IMAGE_PASSTHROUGH_BYTES = 16 * 1024;

/**
 * Applies the shared SDK image policy and adds attachment-specific compression
 * metadata for persistence and API responses.
 */
export async function prepareImageBytes(
	input: Uint8Array,
	mediaType: string,
	options: CompressImageOptions = {},
): Promise<PreparedImageBytes> {
	const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
	const quality = options.quality ?? DEFAULT_QUALITY;
	const prepared = await prepareImageForModel(input, {
		mediaType,
		maxEdge,
		quality,
		passthroughBytes: ENCODED_IMAGE_PASSTHROUGH_BYTES,
	});
	return {
		bytes: prepared.data,
		mediaType: prepared.mediaType,
		...(prepared.compressed
			? {
					compression: {
						compressed: true,
						originalBytes: input.byteLength,
						compressedBytes: prepared.data.byteLength,
						originalMediaType: mediaType,
						maxEdge,
						quality,
					},
				}
			: {}),
	};
}

async function compressImageAttachment(
	attachment: ImageAttachmentPayload,
	options: Required<CompressImageOptions>,
): Promise<ImageAttachmentPayload> {
	const input = Buffer.from(attachment.data, 'base64');
	if (input.byteLength === 0) {
		return attachment;
	}

	const prepared = await prepareImageBytes(
		input,
		attachment.mediaType,
		options,
	);
	if (!prepared.compression) return attachment;

	return {
		...attachment,
		data: Buffer.from(prepared.bytes).toString('base64'),
		mediaType: prepared.mediaType,
		compression: prepared.compression,
	};
}

/**
 * Compresses user-supplied image attachments with Bun.Image before persistence
 * and model submission. Already-efficient or unsupported encoded images are
 * returned unchanged; supported raster images fail closed if processing fails.
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
			if (!compressed.compression) {
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
