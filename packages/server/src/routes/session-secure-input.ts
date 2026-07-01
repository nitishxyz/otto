import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	getPendingSecureInput,
	getPendingSecureInputsForSession,
	resolveSecureInput,
} from '../runtime/tools/secure-input.ts';
import { resolveRequestProject } from './project-context.ts';

const sessionSecureInputParamsSchema = z.object({
	id: z.string().openapi({
		param: { name: 'id', in: 'path' },
		description: 'Session ID',
	}),
});

const secureInputResolveBodySchema = z.object({
	promptId: z.string(),
	value: z.string().optional(),
	cancelled: z.boolean().optional(),
});

const secureInputResolveResponseSchema = z.object({
	ok: z.literal(true),
	promptId: z.string(),
	cancelled: z.boolean(),
});

const secureInputErrorResponseSchema = z.object({
	ok: z.literal(false),
	error: z.string(),
});

const pendingSecureInputSchema = z.object({
	promptId: z.string(),
	messageId: z.string(),
	callId: z.string().optional(),
	prompt: z.string(),
	inputKind: z.literal('password'),
	createdAt: z.number(),
});

const pendingSecureInputsResponseSchema = z.object({
	ok: z.literal(true),
	pending: z.array(pendingSecureInputSchema),
});

export function registerSessionSecureInputRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{id}/secure-input',
			tags: ['sessions'],
			operationId: 'resolveSecureInput',
			summary: 'Resolve a pending secure input prompt',
			request: {
				params: sessionSecureInputParamsSchema,
				body: {
					required: true,
					content: {
						'application/json': {
							schema: secureInputResolveBodySchema,
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'Secure input resolved',
					content: {
						'application/json': {
							schema: secureInputResolveResponseSchema,
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: secureInputErrorResponseSchema,
						},
					},
				},
				'403': {
					description: 'Secure input does not belong to the session',
					content: {
						'application/json': {
							schema: secureInputErrorResponseSchema,
						},
					},
				},
				'404': {
					description: 'Pending secure input not found',
					content: {
						'application/json': {
							schema: secureInputErrorResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			const project = await resolveRequestProject(c);
			const sessionId = c.req.param('id');
			const body = secureInputResolveBodySchema.parse(await c.req.json());

			const pending = getPendingSecureInput(
				body.promptId,
				project.runtime.root,
			);
			if (!pending) {
				return c.json(
					{
						ok: false,
						error: 'No pending secure input found for this promptId',
					},
					404,
				);
			}

			if (pending.sessionId !== sessionId) {
				return c.json(
					{ ok: false, error: 'Secure input does not belong to this session' },
					403,
				);
			}

			const value = body.cancelled === true ? null : (body.value ?? '');
			const result = resolveSecureInput(
				body.promptId,
				value,
				project.runtime.root,
			);
			if (!result.ok) {
				return c.json({ ok: false, error: result.error }, 400);
			}

			return c.json({
				ok: true,
				promptId: body.promptId,
				cancelled: value === null,
			});
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{id}/secure-input/pending',
			tags: ['sessions'],
			operationId: 'listPendingSecureInputs',
			summary: 'List pending secure input prompts for a session',
			request: {
				params: sessionSecureInputParamsSchema,
			},
			responses: {
				'200': {
					description: 'Pending secure input prompts',
					content: {
						'application/json': {
							schema: pendingSecureInputsResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			const project = await resolveRequestProject(c);
			const sessionId = c.req.param('id');
			const pending = getPendingSecureInputsForSession(
				sessionId,
				project.runtime.root,
			).map((input) => ({
				promptId: input.promptId,
				messageId: input.messageId,
				callId: input.callId,
				prompt: input.prompt,
				inputKind: 'password' as const,
				createdAt: input.createdAt,
			}));

			return c.json({ ok: true, pending });
		},
	);
}
