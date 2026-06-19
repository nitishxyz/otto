import { describe, expect, test } from 'bun:test';
import { normalizeXaiResponsesImagePayload } from '../packages/sdk/src/providers/src/xai-client.ts';

describe('xAI Responses image payload normalization', () => {
	test('adds Grok-compatible message type and image detail', () => {
		const payload = {
			model: 'grok-build',
			input: [
				{
					role: 'user',
					content: [
						{ type: 'input_text', text: 'what is this?' },
						{
							type: 'input_image',
							image_url: 'data:image/png;base64,QUJD',
						},
					],
				},
			],
		};

		expect(normalizeXaiResponsesImagePayload(payload)).toEqual({
			model: 'grok-build',
			input: [
				{
					type: 'message',
					role: 'user',
					content: [
						{ type: 'input_text', text: 'what is this?' },
						{
							type: 'input_image',
							image_url: 'data:image/png;base64,QUJD',
							detail: 'auto',
						},
					],
				},
			],
		});
	});

	test('preserves existing detail and non-array text messages', () => {
		const payload = {
			input: [
				{ role: 'system', content: 'system text' },
				{
					type: 'message',
					role: 'user',
					content: [
						{
							type: 'input_image',
							image_url: 'data:image/webp;base64,AAAA',
							detail: 'high',
						},
					],
				},
			],
		};

		expect(normalizeXaiResponsesImagePayload(payload)).toEqual(payload);
	});
});
