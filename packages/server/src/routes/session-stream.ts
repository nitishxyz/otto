import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import { subscribe } from '../events/bus.ts';
import {
	createSSEByteStrategy,
	encodeSSEComment,
	encodeSSEEvent,
} from '../events/sse.ts';
import type { OttoEvent } from '../events/types.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	projectQuerySchema,
	resolveRequestProject,
} from './project-context.ts';

const STREAM_DESCRIPTION =
	'SSE event stream. Events include session.created, message.created, message.part.delta, tool.call, tool.delta, tool.result, message.completed, error.';

const sessionStreamParamsSchema = z.object({
	id: z.string().openapi({
		param: { name: 'id', in: 'path' },
	}),
});

const sessionStreamQuerySchema = projectQuerySchema;

const sessionStreamResponseSchema = z.string().openapi({
	description: STREAM_DESCRIPTION,
});

const eventChunks = new WeakMap<OttoEvent, Uint8Array>();

function encodeEvent(evt: OttoEvent): Uint8Array {
	const cached = eventChunks.get(evt);
	if (cached) return cached;
	const chunk = encodeSSEEvent(evt.type, evt.payload ?? {});
	eventChunks.set(evt, chunk);
	return chunk;
}

async function handleSessionStream(c: Context) {
	const project = await resolveRequestProject(c);
	const sessionId = c.req.param('id');
	const headers = new Headers({
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});

	let cleanedUp = false;
	let cleanup = () => {};

	const stream = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				let unsubscribeProject = () => {};
				let unsubscribeLegacy = () => {};
				let hb: ReturnType<typeof setInterval> | null = null;

				cleanup = () => {
					if (cleanedUp) return;
					cleanedUp = true;
					if (hb !== null) clearInterval(hb);
					unsubscribeProject();
					unsubscribeLegacy();
					try {
						controller.close();
					} catch {}
				};

				const write = (evt: OttoEvent) => {
					if (evt.projectRoot && evt.projectRoot !== project.runtime.root)
						return;
					send(encodeEvent(evt));
				};
				const send = (chunk: Uint8Array) => {
					try {
						controller.enqueue(chunk);
						if ((controller.desiredSize ?? 0) < 0) {
							logger.warn('[sse] dropping backpressured session stream', {
								sessionId,
								projectId: project.projectId,
								chunkBytes: chunk.byteLength,
							});
							cleanup();
						}
					} catch {
						cleanup();
					}
				};
				unsubscribeProject = subscribe(sessionId, write, project.runtime.root);
				unsubscribeLegacy = subscribe(sessionId, write);
				send(encodeSSEComment(`connected ${sessionId}`));
				hb = setInterval(() => {
					send(encodeSSEComment(`hb ${Date.now()}`));
				}, 5000);

				const signal = c.req.raw?.signal as AbortSignal | undefined;
				signal?.addEventListener('abort', cleanup, { once: true });
			},
			cancel() {
				cleanup();
			},
		},
		createSSEByteStrategy(),
	);

	return new Response(stream, { headers });
}

export function registerSessionStreamRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{id}/stream',
			tags: ['stream'],
			operationId: 'subscribeSessionStream',
			summary: 'Subscribe to session event stream (SSE)',
			request: {
				params: sessionStreamParamsSchema,
				query: sessionStreamQuerySchema,
			},
			responses: {
				'200': {
					description: 'text/event-stream',
					content: {
						'text/event-stream': {
							schema: sessionStreamResponseSchema,
						},
					},
				},
			},
		},
		handleSessionStream,
	);
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{id}/stream',
			tags: ['stream'],
			operationId: 'subscribeSessionStreamPost',
			summary: 'Subscribe to session event stream (SSE) using POST',
			request: {
				params: sessionStreamParamsSchema,
				query: sessionStreamQuerySchema,
			},
			responses: {
				'200': {
					description: 'text/event-stream',
					content: {
						'text/event-stream': {
							schema: sessionStreamResponseSchema,
						},
					},
				},
			},
		},
		handleSessionStream,
	);
}
