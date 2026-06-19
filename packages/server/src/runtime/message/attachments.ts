import { logger } from '@ottocode/sdk';
import { storeAttachmentBytes } from '../../routes/attachments.ts';
import type { DispatchOptions } from './types.ts';

export async function attachDirectImages(args: {
	projectRoot: string;
	sessionId: string;
	images?: DispatchOptions['images'];
}): Promise<DispatchOptions['images']> {
	if (!args.images?.length) return args.images;

	return Promise.all(
		args.images.map(async (image, index) => {
			if (image.attachmentId || !image.data) return image;
			try {
				const bytes = Buffer.from(image.data, 'base64');
				const metadata = await storeAttachmentBytes({
					projectRoot: args.projectRoot,
					bytes,
					filename: image.name || `image-${index + 1}`,
					mimeType: image.mediaType,
					sessionId: args.sessionId,
				});
				return {
					...image,
					attachmentId: metadata.id,
					name: metadata.filename,
					original: {
						filename: metadata.filename,
						size: metadata.size,
						sha256: metadata.sha256,
						mimeType: metadata.mimeType,
					},
				};
			} catch (error) {
				logger.warn('Failed to store direct image attachment', {
					error,
					sessionId: args.sessionId,
				});
				return image;
			}
		}),
	);
}
