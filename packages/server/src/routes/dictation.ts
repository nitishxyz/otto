import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas30';
import { openApiRoute } from '../openapi/route.ts';
import { upgradeWebSocket } from '../ws.ts';
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

const dictationSessions = createDictationSessionManager();

type WebSocketLike = {
	send: (data: string) => void;
	close: (code?: number, reason?: string) => void;
};

function jsonSchema(
	properties: Record<string, ReferenceObject | SchemaObject>,
	required: string[] = [],
): SchemaObject {
	return {
		type: 'object',
		properties,
		required,
	};
}

function errorResponseSchema() {
	return jsonSchema({ error: { type: 'string' }, code: { type: 'string' } }, [
		'error',
	]);
}

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
	openApiRoute(
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
							schema: jsonSchema(
								{
									available: { type: 'boolean' },
									engine: { type: 'string' },
									engineInstalled: { type: 'boolean' },
									defaultModel: { type: 'string' },
									format: {
										type: 'object',
										properties: {
											encoding: { type: 'string' },
											sampleRate: { type: 'number' },
											channels: { type: 'number' },
										},
									},
									models: { type: 'array', items: { type: 'object' } },
								},
								[
									'available',
									'engine',
									'engineInstalled',
									'defaultModel',
									'models',
								],
							),
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

	openApiRoute(
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
							schema: jsonSchema(
								{
									models: { type: 'array', items: { type: 'object' } },
								},
								['models'],
							),
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

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/dictation/models/{model}/install',
			tags: ['dictation'],
			operationId: 'installDictationModel',
			summary: 'Install a local dictation model',
			parameters: [
				{
					name: 'model',
					in: 'path',
					required: true,
					schema: { type: 'string' },
				},
			],
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: jsonSchema({ force: { type: 'boolean' } }),
					},
				},
			},
			responses: {
				'200': {
					description: 'Model installed or already present',
					content: {
						'application/json': {
							schema: jsonSchema({ model: { type: 'object' } }, ['model']),
						},
					},
				},
				'202': {
					description: 'Model installation started',
					content: {
						'application/json': {
							schema: jsonSchema({ model: { type: 'object' } }, ['model']),
						},
					},
				},
				'404': {
					description: 'Model not found',
					content: {
						'application/json': { schema: errorResponseSchema() },
					},
				},
				'501': {
					description: 'Model download metadata is not configured',
					content: {
						'application/json': { schema: errorResponseSchema() },
					},
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

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/dictation/models/{model}/install/events',
			tags: ['dictation'],
			operationId: 'streamDictationModelInstallEvents',
			summary: 'Stream local dictation model install progress',
			description:
				'Stream model install progress events via SSE. Generated HTTP clients may need custom SSE handling.',
			parameters: [
				{
					name: 'model',
					in: 'path',
					required: true,
					schema: { type: 'string' },
				},
			],
			responses: {
				'200': {
					description: 'SSE stream of model install progress',
					content: {
						'text/event-stream': {
							schema: { type: 'string' },
						},
					},
				},
				'404': {
					description: 'Model not found',
					content: {
						'application/json': { schema: errorResponseSchema() },
					},
				},
			},
		},
		streamModelInstallEvents,
	);

	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/dictation/models/{model}',
			tags: ['dictation'],
			operationId: 'removeDictationModel',
			summary: 'Remove an installed local dictation model',
			parameters: [
				{
					name: 'model',
					in: 'path',
					required: true,
					schema: { type: 'string' },
				},
			],
			responses: {
				'200': {
					description: 'Model removed',
					content: {
						'application/json': {
							schema: jsonSchema(
								{ removed: { type: 'boolean' }, model: { type: 'object' } },
								['removed', 'model'],
							),
						},
					},
				},
				'404': {
					description: 'Model not found',
					content: {
						'application/json': { schema: errorResponseSchema() },
					},
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

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/dictation/sessions',
			tags: ['dictation'],
			operationId: 'createDictationSession',
			summary: 'Create a streaming dictation session',
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: jsonSchema({
							model: { type: 'string' },
							language: { type: 'string' },
						}),
					},
				},
			},
			responses: {
				'201': {
					description: 'Dictation session created',
					content: {
						'application/json': {
							schema: jsonSchema(
								{
									id: { type: 'string' },
									wsUrl: { type: 'string' },
									model: { type: 'string' },
									modelInstalled: { type: 'boolean' },
									format: { type: 'object' },
								},
								['id', 'wsUrl', 'model', 'modelInstalled', 'format'],
							),
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

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/dictation/sessions/{id}',
			tags: ['dictation'],
			operationId: 'getDictationSession',
			summary: 'Get a dictation session',
			parameters: [
				{
					name: 'id',
					in: 'path',
					required: true,
					schema: { type: 'string' },
				},
			],
			responses: {
				'200': {
					description: 'Dictation session',
					content: {
						'application/json': {
							schema: jsonSchema({ session: { type: 'object' } }, ['session']),
						},
					},
				},
				'404': {
					description: 'Session not found',
					content: {
						'application/json': { schema: errorResponseSchema() },
					},
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

	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/dictation/sessions/{id}',
			tags: ['dictation'],
			operationId: 'deleteDictationSession',
			summary: 'Delete a dictation session',
			parameters: [
				{
					name: 'id',
					in: 'path',
					required: true,
					schema: { type: 'string' },
				},
			],
			responses: {
				'200': {
					description: 'Deleted',
					content: {
						'application/json': {
							schema: jsonSchema({ deleted: { type: 'boolean' } }, ['deleted']),
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

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/dictation/sessions/{id}/ws',
			tags: ['dictation'],
			operationId: 'connectDictationSessionWebSocket',
			summary: 'Connect to dictation WebSocket',
			description:
				'Upgrade to a WebSocket for streaming PCM audio frames and receiving transcript events.',
			parameters: [
				{
					name: 'id',
					in: 'path',
					required: true,
					schema: { type: 'string' },
				},
			],
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
