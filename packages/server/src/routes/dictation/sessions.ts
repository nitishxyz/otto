import type { Hono } from 'hono';
import {
	getDictationModelState,
	requireDictationModel,
} from '../../dictation/models.ts';
import { DEFAULT_DICTATION_MODEL } from '../../dictation/types.ts';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import { sessionResponse } from './helpers.ts';
import {
	createDictationSessionResponseSchema,
	createSessionBodySchema,
	deleteDictationSessionResponseSchema,
	errorResponseSchema,
	getDictationSessionResponseSchema,
	sessionParamsSchema,
} from './schemas.ts';
import { dictationSessions } from './state.ts';
import { registerDictationWebSocketRoute } from './websocket.ts';
import { createDictationWebSocketTicket } from './ws-ticket.ts';

export function registerDictationSessionRoutes(app: Hono) {
	registerCreateDictationSessionRoute(app);
	registerGetDictationSessionRoute(app);
	registerDeleteDictationSessionRoute(app);
	registerDictationWebSocketRoute(app);
}

function registerCreateDictationSessionRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/dictation/sessions',
			tags: ['dictation'],
			operationId: 'createDictationSession',
			summary: 'Create a streaming dictation session',
			request: {
				body: {
					required: false,
					content: {
						'application/json': { schema: createSessionBodySchema },
					},
				},
			},
			responses: {
				'201': {
					description: 'Dictation session created',
					content: {
						'application/json': {
							schema: createDictationSessionResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			const body = await c.req.json().catch(() => ({}));
			const requestedModel =
				typeof body.model === 'string' ? body.model : DEFAULT_DICTATION_MODEL;
			let modelInstalled = false;
			try {
				const model = requireDictationModel(requestedModel);
				modelInstalled = (await getDictationModelState(model)).installed;
			} catch {
				modelInstalled = false;
			}
			const projectRoot = await resolveRequestProjectRoot(c).catch(
				() => undefined,
			);
			const session = dictationSessions.create({
				model: requestedModel,
				language: typeof body.language === 'string' ? body.language : undefined,
				prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
				projectRoot,
			});
			const { ticket } = createDictationWebSocketTicket({
				sessionId: session.id,
				projectId:
					c.req.header('X-Otto-Share-Project-Id') ??
					c.req.header('X-Otto-Project-Id') ??
					c.req.query('projectId'),
				shareToken: c.req.header('X-Otto-Share-Token'),
			});
			return c.json(
				{
					id: session.id,
					wsUrl: sessionResponse(session.id, ticket, c),
					model: session.model,
					modelInstalled,
					format: session.format,
				},
				201,
			);
		},
	);
}

function registerGetDictationSessionRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/dictation/sessions/{id}',
			tags: ['dictation'],
			operationId: 'getDictationSession',
			summary: 'Get a dictation session',
			request: { params: sessionParamsSchema },
			responses: {
				'200': {
					description: 'Dictation session',
					content: {
						'application/json': { schema: getDictationSessionResponseSchema },
					},
				},
				'404': {
					description: 'Session not found',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		(c) => {
			const session = dictationSessions.get(c.req.param('id'));
			if (!session)
				return c.json({ error: 'Dictation session not found' }, 404);
			return c.json({ session });
		},
	);
}

function registerDeleteDictationSessionRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/dictation/sessions/{id}',
			tags: ['dictation'],
			operationId: 'deleteDictationSession',
			summary: 'Delete a dictation session',
			request: { params: sessionParamsSchema },
			responses: {
				'200': {
					description: 'Deleted',
					content: {
						'application/json': {
							schema: deleteDictationSessionResponseSchema,
						},
					},
				},
			},
		},
		async (c) => {
			const deleted = await dictationSessions.delete(c.req.param('id'));
			return c.json({ deleted });
		},
	);
}
