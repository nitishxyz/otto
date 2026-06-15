import { describe, expect, test } from 'bun:test';
import {
	createKimiUsageFetch,
	hoistKimiSseUsage,
	sanitizeKimiToolSchema,
} from '../packages/sdk/src/providers/src/kimi-client.ts';

const FINAL_CHUNK = JSON.stringify({
	id: 'cmpl-1',
	object: 'chat.completion.chunk',
	choices: [
		{
			index: 0,
			delta: {},
			finish_reason: 'stop',
			usage: { prompt_tokens: 19, completion_tokens: 13, total_tokens: 32 },
		},
	],
});

describe('hoistKimiSseUsage', () => {
	test('hoists choice-level usage to top level', () => {
		const out = hoistKimiSseUsage(`data: ${FINAL_CHUNK}`);
		const parsed = JSON.parse(out.slice('data: '.length));
		expect(parsed.usage).toEqual({
			prompt_tokens: 19,
			completion_tokens: 13,
			total_tokens: 32,
		});
		expect(parsed.choices[0].usage).toEqual(parsed.usage);
	});

	test('keeps existing top-level usage untouched', () => {
		const chunk = JSON.stringify({
			choices: [{ index: 0, delta: {}, usage: { prompt_tokens: 5 } }],
			usage: { prompt_tokens: 99 },
		});
		const out = hoistKimiSseUsage(`data: ${chunk}`);
		expect(JSON.parse(out.slice('data: '.length)).usage).toEqual({
			prompt_tokens: 99,
		});
	});

	test('passes through non-data and [DONE] lines', () => {
		expect(hoistKimiSseUsage('data: [DONE]')).toBe('data: [DONE]');
		expect(hoistKimiSseUsage('')).toBe('');
		expect(hoistKimiSseUsage(': keep-alive')).toBe(': keep-alive');
	});

	test('preserves trailing carriage returns', () => {
		const out = hoistKimiSseUsage(`data: ${FINAL_CHUNK}\r`);
		expect(out.endsWith('\r')).toBe(true);
		const parsed = JSON.parse(out.slice('data: '.length, -1));
		expect(parsed.usage.total_tokens).toBe(32);
	});
});

describe('createKimiUsageFetch', () => {
	test('sanitizes tool schemas before Kimi requests are sent', async () => {
		let capturedBody: Record<string, unknown> | undefined;
		const baseFetch = (async (_input, init) => {
			capturedBody = JSON.parse(String(init?.body ?? '{}'));
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}) as typeof fetch;

		const wrapped = createKimiUsageFetch(baseFetch);
		await wrapped('https://api.kimi.test/v1/chat/completions', {
			method: 'POST',
			body: JSON.stringify({
				tools: [
					{
						type: 'function',
						function: {
							name: 'read',
							parameters: {
								$schema: 'http://json-schema.org/draft-07/schema#',
								type: 'object',
								properties: {
									path: {
										type: 'string',
										default: '.',
										minLength: 1,
									},
									endLine: {
										anyOf: [
											{ type: 'integer' },
											{ const: 'end', type: 'string' },
										],
									},
								},
								required: ['path'],
							},
						},
					},
				],
			}),
		});

		const parameters = ((
			(capturedBody?.tools as Array<Record<string, unknown>>)[0]
				.function as Record<string, unknown>
		).parameters ?? {}) as Record<string, unknown>;
		expect(parameters).not.toHaveProperty('$schema');
		const properties = parameters.properties as Record<
			string,
			Record<string, unknown>
		>;
		expect(properties.path).toEqual({ type: 'string', default: '.' });
		expect(properties.endLine).toEqual({
			anyOf: [{ type: 'integer' }, { enum: ['end'], type: 'string' }],
		});
	});

	test('rewrites SSE streams so usage is exposed at the top level', async () => {
		const sse = [
			'data: {"choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
			'',
			`data: ${FINAL_CHUNK}`,
			'',
			'data: [DONE]',
			'',
		].join('\n');

		const baseFetch = (async () =>
			new Response(sse, {
				status: 200,
				headers: { 'content-type': 'text/event-stream' },
			})) as typeof fetch;

		const wrapped = createKimiUsageFetch(baseFetch);
		const res = await wrapped('https://api.kimi.test/v1/chat/completions');
		const text = await res.text();

		const dataLines = text
			.split('\n')
			.filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'));
		expect(dataLines.length).toBe(2);
		const finalChunk = JSON.parse(dataLines[1].slice('data: '.length));
		expect(finalChunk.usage).toEqual({
			prompt_tokens: 19,
			completion_tokens: 13,
			total_tokens: 32,
		});
	});

	test('leaves non-SSE responses untouched', async () => {
		const body = JSON.stringify({ ok: true });
		const baseFetch = (async () =>
			new Response(body, {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})) as typeof fetch;

		const wrapped = createKimiUsageFetch(baseFetch);
		const res = await wrapped('https://api.kimi.test/v1/models');
		expect(await res.text()).toBe(body);
	});
});

describe('sanitizeKimiToolSchema', () => {
	test('strips unsupported JSON Schema keywords recursively', () => {
		expect(
			sanitizeKimiToolSchema({
				$schema: 'http://json-schema.org/draft-07/schema#',
				type: 'object',
				properties: {
					path: { type: 'string', default: '.', minLength: 1 },
				},
				required: ['path'],
			}),
		).toEqual({
			type: 'object',
			properties: { path: { type: 'string', default: '.' } },
			required: ['path'],
		});
	});

	test('preserves property names that match unsupported schema keywords', () => {
		expect(
			sanitizeKimiToolSchema({
				type: 'object',
				properties: {
					pattern: {
						type: 'string',
						pattern: '^.+$',
						minLength: 1,
					},
				},
				required: ['pattern'],
			}),
		).toEqual({
			type: 'object',
			properties: { pattern: { type: 'string' } },
			required: ['pattern'],
		});
	});

	test('preserves MFJS anyOf while converting const to enum', () => {
		expect(
			sanitizeKimiToolSchema({
				anyOf: [
					{ const: 'append', type: 'string' },
					{ const: 'end', type: 'string' },
				],
			}),
		).toEqual({
			anyOf: [
				{ enum: ['append'], type: 'string' },
				{ enum: ['end'], type: 'string' },
			],
		});
	});
});
