import { describe, expect, test } from 'bun:test';
import {
	normalizeXaiResponsesImagePayload,
	normalizeXaiResponsesPayload,
	prepareXaiResponsesPromptFiles,
} from '../packages/sdk/src/providers/src/xai-client.ts';

describe('xAI Responses payload normalization', () => {
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

	test('converts uploaded file markers to xAI file_id input parts', () => {
		const payload = {
			input: [
				{
					role: 'user',
					content: [
						{ type: 'input_text', text: 'summarize' },
						{
							type: 'input_file',
							file_url: 'xai-file-id:file_a128090d-f0c9',
						},
					],
				},
			],
		};

		expect(normalizeXaiResponsesPayload(payload)).toEqual({
			input: [
				{
					type: 'message',
					role: 'user',
					content: [
						{ type: 'input_text', text: 'summarize' },
						{
							type: 'input_file',
							file_id: 'file_a128090d-f0c9',
						},
					],
				},
			],
		});
	});

	test('uploads inline non-image files before xAI prompt conversion', async () => {
		const uploadRequests: Request[] = [];
		const mockFetch = async (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			uploadRequests.push(new Request(input, init));
			return new Response(JSON.stringify({ id: 'file_uploaded_pdf' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		};
		const prompt = [
			{
				role: 'user' as const,
				content: [
					{ type: 'text' as const, text: 'read this' },
					{
						type: 'file' as const,
						data: 'JVBERi0xLjQ=',
						filename: 'brief.pdf',
						mediaType: 'application/pdf',
					},
				],
			},
		];

		const prepared = await prepareXaiResponsesPromptFiles(prompt, {
			apiKey: 'xai-key',
			baseURL: 'https://api.x.ai/v1',
			fetch: mockFetch,
		});

		expect(uploadRequests).toHaveLength(1);
		expect(uploadRequests[0].url).toBe('https://api.x.ai/v1/files');
		expect(uploadRequests[0].headers.get('authorization')).toBe(
			'Bearer xai-key',
		);
		const uploadFormData = await uploadRequests[0].formData();
		expect(uploadFormData.get('purpose')).toBe('assistants');
		expect(prepared[0].content[1]).toMatchObject({
			type: 'file',
			filename: 'brief.pdf',
			mediaType: 'application/pdf',
		});
		expect(String(prepared[0].content[1].data)).toBe(
			'xai-file-id:file_uploaded_pdf',
		);
	});

	test('defaults uploads to the xAI Files API host', async () => {
		const uploadRequests: Request[] = [];
		const mockFetch = async (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			uploadRequests.push(new Request(input, init));
			return new Response(JSON.stringify({ id: 'file_uploaded_doc' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		};

		await prepareXaiResponsesPromptFiles(
			[
				{
					role: 'user' as const,
					content: [
						{
							type: 'file' as const,
							data: 'aGVsbG8=',
							filename: 'notes.txt',
							mediaType: 'text/plain',
						},
					],
				},
			],
			{
				apiKey: 'oauth-token',
				fetch: mockFetch,
			},
		);

		expect(uploadRequests[0].url).toBe('https://api.x.ai/v1/files');
	});
});
