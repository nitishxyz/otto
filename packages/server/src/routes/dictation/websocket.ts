import type { Hono } from 'hono';
import { parseDictationClientMessage } from '../../dictation/protocol.ts';
import type { DictationClientMessage } from '../../dictation/types.ts';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { toErrorMessage } from '../../runtime/errors/handling.ts';
import { upgradeWebSocket } from '../../ws.ts';
import {
	handleSessionError,
	sendError,
	sendEvent,
	toAudioFrame,
	type WebSocketLike,
} from './helpers.ts';
import { sessionParamsSchema } from './schemas.ts';
import { dictationSessions } from './state.ts';

export function registerDictationWebSocketRoute(app: Hono) {
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
						sendError(ws, 'DICTATION_INVALID_STATE', toErrorMessage(error));
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
