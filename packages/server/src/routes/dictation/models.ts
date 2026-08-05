import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { DICTATION_MODELS } from '../../dictation/manifest.ts';
import { deriveProjectVocabulary } from '../../dictation/prompt.ts';
import {
	installDictationModel,
	listDictationModelStates,
	removeDictationModel,
} from '../../dictation/models.ts';
import {
	DEFAULT_AUDIO_FORMAT,
	DEFAULT_DICTATION_MODEL,
} from '../../dictation/types.ts';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import { modelErrorResponse, streamModelInstallEvents } from './helpers.ts';
import {
	dictationModelResponseSchema,
	dictationModelsResponseSchema,
	dictationStatusResponseSchema,
	errorResponseSchema,
	installModelBodySchema,
	modelParamsSchema,
	removeDictationModelResponseSchema,
} from './schemas.ts';

export function registerDictationModelRoutes(app: Hono) {
	registerDictationStatusRoute(app);
	registerListDictationModelsRoute(app);
	registerInstallDictationModelRoute(app);
	registerStreamDictationModelInstallEventsRoute(app);
	registerRemoveDictationModelRoute(app);
}

function registerDictationStatusRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/dictation/status',
			tags: ['dictation'],
			operationId: 'getDictationStatus',
			summary: 'Get local dictation status',
			responses: {
				'200': {
					description: 'Dictation status',
					content: {
						'application/json': { schema: dictationStatusResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const projectRoot = await resolveRequestProjectRoot(c).catch(
				() => undefined,
			);
			return c.json({
				available: true,
				engine: 'whisper.cpp',
				engineInstalled: false,
				defaultModel: DEFAULT_DICTATION_MODEL,
				format: DEFAULT_AUDIO_FORMAT,
				projectKeywords: projectRoot
					? await deriveProjectVocabulary(projectRoot)
					: [],
				models: await listDictationModelStates(DICTATION_MODELS),
			});
		},
	);
}

function registerListDictationModelsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/dictation/models',
			tags: ['dictation'],
			operationId: 'listDictationModels',
			summary: 'List local dictation models',
			responses: {
				'200': {
					description: 'Dictation models',
					content: {
						'application/json': { schema: dictationModelsResponseSchema },
					},
				},
			},
		},
		async (c) =>
			c.json({
				models: await listDictationModelStates(DICTATION_MODELS),
			}),
	);
}

function registerInstallDictationModelRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/dictation/models/{model}/install',
			tags: ['dictation'],
			operationId: 'installDictationModel',
			summary: 'Install a local dictation model',
			request: {
				params: modelParamsSchema,
				body: {
					required: false,
					content: {
						'application/json': { schema: installModelBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Model installed or already present',
					content: {
						'application/json': { schema: dictationModelResponseSchema },
					},
				},
				'202': {
					description: 'Model installation started',
					content: {
						'application/json': { schema: dictationModelResponseSchema },
					},
				},
				'404': {
					description: 'Model not found',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
				'501': {
					description: 'Model download metadata is not configured',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const body = await c.req.json().catch(() => ({}));
				const model = await installDictationModel(c.req.param('model'), {
					force: body.force === true,
				});
				return c.json({ model }, model.installing ? 202 : 200);
			} catch (error) {
				return modelErrorResponse(c, error);
			}
		},
	);
}

function registerStreamDictationModelInstallEventsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/dictation/models/{model}/install/events',
			tags: ['dictation'],
			operationId: 'streamDictationModelInstallEvents',
			summary: 'Stream local dictation model install progress',
			description:
				'Stream model install progress events via SSE. Generated HTTP clients may need custom SSE handling.',
			request: { params: modelParamsSchema },
			responses: {
				'200': {
					description: 'SSE stream of model install progress',
					content: { 'text/event-stream': { schema: z.string() } },
				},
				'404': {
					description: 'Model not found',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		streamModelInstallEvents,
	);
}

function registerRemoveDictationModelRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/dictation/models/{model}',
			tags: ['dictation'],
			operationId: 'removeDictationModel',
			summary: 'Remove an installed local dictation model',
			request: { params: modelParamsSchema },
			responses: {
				'200': {
					description: 'Model removed',
					content: {
						'application/json': { schema: removeDictationModelResponseSchema },
					},
				},
				'404': {
					description: 'Model not found',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				return c.json(await removeDictationModel(c.req.param('model')));
			} catch (error) {
				return modelErrorResponse(c, error);
			}
		},
	);
}
