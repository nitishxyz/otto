import { z } from '@hono/zod-openapi';
import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DICTATION_MODELS } from '../dictation/manifest.ts';
import {
	DictationModelError,
	getDictationModelInstallPromise,
	getDictationModelState,
	installDictationModel,
	listDictationModelStates,
	removeDictationModel,
	requireDictationModel,
} from '../dictation/models.ts';
import {
	encodeDictationEvent,
	parseDictationClientMessage,
} from '../dictation/protocol.ts';
import {
	DictationSessionError,
	createDictationSessionManager,
} from '../dictation/sessions.ts';
import {
	DEFAULT_AUDIO_FORMAT,
	DEFAULT_DICTATION_MODEL,
	type DictationClientMessage,
	type DictationServerEvent,
} from '../dictation/types.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { upgradeWebSocket } from '../ws.ts';

const dictationSessions = createDictationSessionManager();

type WebSocketLike = {
	send: (data: string) => void;
	close: (code?: number, reason?: string) => void;
};

const errorResponseSchema = z.object({
	error: z.string(),
	code: z.string().optional(),
});

const audioFormatSchema = z.object({
	encoding: z.string(),
	sampleRate: z.number(),
	channels: z.number(),
});

const dictationModelSchema = z
	.object({
		id: z.string(),
		label: z.string(),
		language: z.enum(['en', 'multi']),
		sizeBytes: z.number(),
		url: z.string(),
		sha256: z.string(),
		recommended: z.boolean().optional(),
		installed: z.boolean(),
		installing: z.boolean(),
		installedSizeBytes: z.number(),
		installStatus: z.enum([
			'idle',
			'installing',
			'verifying',
			'installed',
			'error',
		]),
		progressBytes: z.number(),
		totalBytes: z.number(),
		error: z.string().optional(),
		errorCode: z.string().optional(),
	})
	.passthrough();

const dictationSessionSchema = z
	.object({
		id: z.string(),
		status: z.enum([
			'created',
			'recording',
			'transcribing',
			'completed',
			'cancelled',
			'error',
		]),
		model: z.string(),
		language: z.string(),
		format: audioFormatSchema,
		createdAt: z.string(),
		updatedAt: z.string(),
		receivedBytes: z.number(),
		receivedMs: z.number(),
		pcmPath: z.string(),
		wavPath: z.string(),
		text: z.string().optional(),
		error: z.string().optional(),
	})
	.passthrough();

const modelParamsSchema = z.object({
	model: z.string().openapi({ param: { name: 'model', in: 'path' } }),
});

const sessionParamsSchema = z.object({
	id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
});

const installModelBodySchema = z.object({
	force: z.boolean().optional(),
});

const createSessionBodySchema = z.object({
	model: z.string().optional(),
	language: z.string().optional(),
});

function sessionResponse(sessionId: string, c: Context) {
	const url = new URL(c.req.url);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.pathname = `/v1/dictation/sessions/${encodeURIComponent(sessionId)}/ws`;
	url.search = '';
	return url.toString();
}

function sendEvent(ws: WebSocketLike, event: DictationServerEvent) {
	try {
		ws.send(encodeDictationEvent(event));
	} catch {
		// Socket may already be closed.
	}
}

function sendError(
	ws: WebSocketLike,
	code: DictationServerEvent extends infer Event
		? Event extends { type: 'error'; code: infer Code }
			? Code
			: never
		: never,
	message: string,
) {
	sendEvent(ws, { type: 'error', code, message });
}

function toAudioFrame(data: unknown): Uint8Array | null {
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}
	return null;
}

function handleSessionError(ws: WebSocketLike, error: unknown) {
	if (error instanceof DictationSessionError) {
		sendError(ws, error.code, error.message);
		return;
	}
	sendError(
		ws,
		'DICTATION_TRANSCRIBE_FAILED',
		error instanceof Error ? error.message : String(error),
	);
}

function modelErrorResponse(c: Context, error: unknown) {
	if (error instanceof DictationModelError) {
		return c.json(
			{ error: error.message, code: error.code },
			error.status as ContentfulStatusCode,
		);
	}
	return c.json(
		{
			error: error instanceof Error ? error.message : String(error),
			code: 'DICTATION_MODEL_DOWNLOAD_FAILED',
		},
		500,
	);
}

async function streamModelInstallEvents(c: Context) {
	let model: ReturnType<typeof requireDictationModel>;
	try {
		model = requireDictationModel(c.req.param('model'));
	} catch (error) {
		return modelErrorResponse(c, error);
	}

	return streamSSE(c, async (stream) => {
		const sendState = async () => {
			const state = await getDictationModelState(model);
			await stream.write(
				`data: ${JSON.stringify({ type: 'model', model: state })}\n\n`,
			);
			return state;
		};

		let state = await sendState();
		while (state.installing && !c.req.raw.signal.aborted) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			state = await sendState();
		}

		await getDictationModelInstallPromise(model.id)?.catch(() => {});
		stream.close();
	});
}

export function registerDictationRoutes(app: Hono) {
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
						'application/json': {
							schema: z.object({
								available: z.boolean(),
								engine: z.string(),
								engineInstalled: z.boolean(),
								defaultModel: z.string(),
								format: audioFormatSchema.optional(),
								models: z.array(dictationModelSchema),
							}),
						},
					},
				},
			},
		},
		async (c) =>
			c.json({
				available: true,
				engine: 'whisper.cpp',
				engineInstalled: false,
				defaultModel: DEFAULT_DICTATION_MODEL,
				format: DEFAULT_AUDIO_FORMAT,
				models: await listDictationModelStates(DICTATION_MODELS),
			}),
	);

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
						'application/json': {
							schema: z.object({ models: z.array(dictationModelSchema) }),
						},
					},
				},
			},
		},
		async (c) =>
			c.json({
				models: await listDictationModelStates(DICTATION_MODELS),
			}),
	);

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
						'application/json': {
							schema: z.object({ model: dictationModelSchema }),
						},
					},
				},
				'202': {
					description: 'Model installation started',
					content: {
						'application/json': {
							schema: z.object({ model: dictationModelSchema }),
						},
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
						'application/json': {
							schema: z.object({
								removed: z.boolean(),
								model: dictationModelSchema,
							}),
						},
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
							schema: z.object({
								id: z.string(),
								wsUrl: z.string(),
								model: z.string(),
								modelInstalled: z.boolean(),
								format: audioFormatSchema,
							}),
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
			const session = dictationSessions.create({
				model: requestedModel,
				language: typeof body.language === 'string' ? body.language : undefined,
			});
			return c.json(
				{
					id: session.id,
					wsUrl: sessionResponse(session.id, c),
					model: session.model,
					modelInstalled,
					format: session.format,
				},
				201,
			);
		},
	);

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
						'application/json': {
							schema: z.object({ session: dictationSessionSchema }),
						},
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
							schema: z.object({ deleted: z.boolean() }),
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

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/dictation/sessions/{id}/ws',
			tags: ['dictation'],
			operationId: 'connectDictationSessionWebSocket',
			summary: 'Connect to dictation WebSocket',
			description:
				'Upgrade to a WebSocket for streaming PCM audio frames and receiving transcript events.',
			request: { params: sessionParamsSchema },
			responses: {
				'101': { description: 'WebSocket upgrade accepted' },
				'404': { description: 'Session not found' },
			},
		},
		upgradeWebSocket((c) => {
			const id = c.req.param('id');
			return {
				onOpen(_event: unknown, ws: WebSocketLike) {
					const session = dictationSessions.get(id);
					if (!session) {
						ws.close(4004, 'Dictation session not found');
					}
				},
				onMessage(event: { data: unknown }, ws: WebSocketLike) {
					const frame = toAudioFrame(event.data);
					if (frame) {
						void dictationSessions
							.appendAudioFrame(id, frame)
							.then((session) => {
								sendEvent(ws, {
									type: 'recording',
									receivedMs: session.receivedMs,
									receivedBytes: session.receivedBytes,
								});
							})
							.catch((error) => handleSessionError(ws, error));
						return;
					}

					if (typeof event.data !== 'string') {
						sendError(
							ws,
							'DICTATION_AUDIO_FORMAT_UNSUPPORTED',
							'Unsupported WebSocket message payload',
						);
						return;
					}

					let message: DictationClientMessage;
					try {
						message = parseDictationClientMessage(event.data);
					} catch (error) {
						sendError(
							ws,
							'DICTATION_INVALID_STATE',
							error instanceof Error ? error.message : String(error),
						);
						return;
					}

					if (message.type === 'start') {
						void dictationSessions
							.start(id, message)
							.then((session) => {
								sendEvent(ws, {
									type: 'ready',
									sessionId: session.id,
									model: session.model,
									format: session.format,
								});
							})
							.catch((error) => handleSessionError(ws, error));
						return;
					}

					if (message.type === 'stop') {
						void dictationSessions
							.stop(id)
							.then((event) => {
								sendEvent(ws, event);
								ws.close(1000, 'Dictation completed');
							})
							.catch((error) => handleSessionError(ws, error));
						return;
					}

					void dictationSessions.cancel(id).finally(() => {
						ws.close(1000, 'Dictation cancelled');
					});
				},
				onClose() {
					const session = dictationSessions.get(id);
					if (session?.status === 'recording') {
						void dictationSessions.cancel(id);
					}
				},
				onError() {
					const session = dictationSessions.get(id);
					if (session?.status === 'recording') {
						void dictationSessions.cancel(id);
					}
				},
			};
		}),
	);
}
