import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import {
	compressFileImageAttachments,
	compressImageAttachments,
} from '../packages/server/src/runtime/message/image-compression.ts';

const appIconUrl = new URL(
	'../apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_512x512@2x.png',
	import.meta.url,
);

describe('image compression', () => {
	test('compresses image attachments with Bun.Image', async () => {
		const input = await readFile(appIconUrl);
		const [compressed] = await compressImageAttachments(
			[
				{
					data: input.toString('base64'),
					mediaType: 'image/png',
				},
			],
			{ maxEdge: 128, quality: 80 },
		);

		expect(compressed.mediaType).toBe('image/jpeg');
		expect(compressed.compression).toMatchObject({
			compressed: true,
			originalBytes: input.byteLength,
			originalMediaType: 'image/png',
			maxEdge: 128,
			quality: 80,
		});
		expect(Buffer.from(compressed.data, 'base64').byteLength).toBeLessThan(
			input.byteLength,
		);
	});

	test('leaves unsupported image formats unchanged', async () => {
		const attachment = {
			data: 'not-a-real-gif',
			mediaType: 'image/gif',
		};

		expect(await compressImageAttachments([attachment])).toEqual([attachment]);
	});

	test('compresses only image entries in mixed file attachments', async () => {
		const input = await readFile(appIconUrl);
		const [imageFile, textFile] = await compressFileImageAttachments(
			[
				{
					type: 'image',
					name: 'icon.png',
					data: input.toString('base64'),
					mediaType: 'image/png',
				},
				{
					type: 'text',
					name: 'notes.txt',
					data: 'hello',
					mediaType: 'text/plain',
					textContent: 'hello',
				},
			],
			{ maxEdge: 128, quality: 80 },
		);

		expect(imageFile.mediaType).toBe('image/jpeg');
		expect(imageFile.compression?.compressed).toBe(true);
		expect(textFile).toEqual({
			type: 'text',
			name: 'notes.txt',
			data: 'hello',
			mediaType: 'text/plain',
			textContent: 'hello',
		});
	});
});
