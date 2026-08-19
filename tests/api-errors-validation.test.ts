import { afterEach, describe, expect, test } from 'bun:test';
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { zodOpenApiRoute } from '../packages/server/src/openapi/route.ts';
import {
	APIError,
	apiErrorResponseSchema,
	createErrorResponse,
	createRequestValidationError,
} from '../packages/server/src/runtime/errors/api-error.ts';
import {
	isDebugEnabled,
	setDebugEnabled,
} from '../packages/server/src/runtime/debug/state.ts';

afterEach(() => setDebugEnabled(false));

function createValidationApp() {
	const app = new OpenAPIHono({
		defaultHook: (result) => {
			if (!result.success) {
				throw createRequestValidationError(result.target, result.error);
			}
		},
	});
	app.onError((error, c) => {
		const [body, status] = createErrorResponse(error);
		return c.json(body, status);
	});
	return app;
}

describe('canonical API errors', () => {
	test.each([400, 401, 404, 409] as const)(
		'preserves expected APIError status %p, code, and details',
		(status) => {
			const [body, responseStatus] = createErrorResponse(
				new APIError('Expected failure', {
					status,
					code: 'expected_failure',
					details: { resource: 'test' },
				}),
			);

			expect(responseStatus).toBe(status);
			expect(body.error).toMatchObject({
				message: 'Expected failure',
				status,
				code: 'expected_failure',
				details: { resource: 'test' },
			});
			expect(apiErrorResponseSchema.safeParse(body).success).toBe(true);
		},
	);

	test('classifies an unexpected exception as 500', () => {
		const [body, status] = createErrorResponse(new Error('boom'));
		expect(status).toBe(500);
		expect(body.error.status).toBe(500);
		expect(body.error.message).toBe('boom');
	});

	test('only includes stacks while debug mode is enabled', () => {
		const error = new Error('debuggable');
		expect(isDebugEnabled()).toBe(false);
		expect(createErrorResponse(error)[0].error.stack).toBeUndefined();

		setDebugEnabled(true);
		expect(createErrorResponse(error)[0].error.stack).toContain('debuggable');
	});
});

describe('Zod-first request consumption', () => {
	test('uses coerced and defaulted validated JSON values', async () => {
		const app = createValidationApp();
		const bodySchema = z.object({
			count: z.coerce.number().int().default(3),
		});
		zodOpenApiRoute(
			app,
			{
				method: 'post',
				path: '/values',
				request: {
					body: {
						required: true,
						content: { 'application/json': { schema: bodySchema } },
					},
				},
				responses: {
					'200': {
						description: 'OK',
						content: { 'application/json': { schema: bodySchema } },
					},
				},
			},
			(c) => c.json(c.req.valid('json')),
		);

		const coerced = await app.request('/values', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ count: '4' }),
		});
		expect(await coerced.json()).toEqual({ count: 4 });

		const defaulted = await app.request('/values', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		});
		expect(await defaulted.json()).toEqual({ count: 3 });
	});

	test('supports an empty optional body without reparsing it', async () => {
		const app = createValidationApp();
		zodOpenApiRoute(
			app,
			{
				method: 'post',
				path: '/optional',
				request: {
					body: {
						required: false,
						content: {
							'application/json': { schema: z.object({ value: z.string() }) },
						},
					},
				},
				responses: {
					'200': {
						description: 'OK',
						content: {
							'application/json': { schema: z.object({ empty: z.boolean() }) },
						},
					},
				},
			},
			(c) =>
				c.json({
					empty: Object.keys(c.req.valid('json') ?? {}).length === 0,
				}),
		);

		const response = await app.request('/optional', { method: 'POST' });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ empty: true });
	});

	test.each([
		['body', '/body', 'POST', { 'content-type': 'application/json' }, '{}'],
		['query', '/query?limit=0', 'GET', undefined, undefined],
		['param', '/items/not-a-number', 'GET', undefined, undefined],
	] as const)(
		'returns canonical 400 for invalid %s input',
		async (_, url, method, headers, body) => {
			const app = createValidationApp();
			const responseSchema = z.object({ ok: z.boolean() });
			zodOpenApiRoute(
				app,
				{
					method: 'post',
					path: '/body',
					request: {
						body: {
							required: true,
							content: {
								'application/json': { schema: z.object({ name: z.string() }) },
							},
						},
					},
					responses: {
						'200': {
							description: 'OK',
							content: { 'application/json': { schema: responseSchema } },
						},
					},
				},
				(c) => {
					c.req.valid('json');
					return c.json({ ok: true });
				},
			);
			zodOpenApiRoute(
				app,
				{
					method: 'get',
					path: '/query',
					request: {
						query: z.object({ limit: z.coerce.number().int().min(1) }),
					},
					responses: {
						'200': {
							description: 'OK',
							content: { 'application/json': { schema: responseSchema } },
						},
					},
				},
				(c) => {
					c.req.valid('query');
					return c.json({ ok: true });
				},
			);
			zodOpenApiRoute(
				app,
				{
					method: 'get',
					path: '/items/{id}',
					request: { params: z.object({ id: z.coerce.number().int() }) },
					responses: {
						'200': {
							description: 'OK',
							content: { 'application/json': { schema: responseSchema } },
						},
					},
				},
				(c) => {
					c.req.valid('param');
					return c.json({ ok: true });
				},
			);

			const response = await app.request(url, { method, headers, body });
			expect(response.status).toBe(400);
			const payload = await response.json();
			expect(payload).toMatchObject({
				error: {
					code: 'invalid_request',
					status: 400,
					details: { target: _ === 'body' ? 'json' : _ },
				},
			});
		},
	);
});
