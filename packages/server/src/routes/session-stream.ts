import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import { subscribe } from '../events/bus.ts';
import {
	createSSEEncodingCache,
	createSSEResponse,
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

const encodeEvent = createSSEEncodingCache((evt: OttoEvent) =>
	encodeSSEEvent(evt.type, evt.payload ?? {}),
);

async function handleSessionStream(c: Context) {
	const project = await resolveRequestProject(c);
	const sessionId = c.req.param('id');
	return createSSEResponse({
		signal: c.req.raw?.signal,
		initialChunk: encodeSSEComment(`connected ${sessionId}`),
		heartbeat: {
			intervalMs: 5000,
			createChunk: () => encodeSSEComment(`hb ${Date.now()}`),
		},
		onBackpressure(chunk) {
			logger.warn('[sse] dropping backpressured session stream', {
				sessionId,
				projectId: project.projectId,
				chunkBytes: chunk.byteLength,
			});
		},
		start({ send, onCleanup }) {
			const write = (evt: OttoEvent) => {
				if (evt.projectRoot && evt.projectRoot !== project.runtime.root) return;
				send(encodeEvent(evt));
			};
			onCleanup(subscribe(sessionId, write, project.runtime.root));
			onCleanup(subscribe(sessionId, write));
		},
	});
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
