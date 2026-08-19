import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import { subscribeClientEvents } from '../events/bus.ts';
import {
	createSSEEncodingCache,
	createSSEResponse,
	encodeSSEComment,
	encodeSSEEvent,
} from '../events/sse.ts';
import type { ClientEvent } from '../events/types.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';

const STREAM_DESCRIPTION =
	'SSE event stream. Events include notification, session.status, reference.preparation, and heartbeat.';

const clientEventsQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const clientEventsStreamSchema = z.string().openapi({
	description: STREAM_DESCRIPTION,
});

const encodeEvent = createSSEEncodingCache((evt: ClientEvent) =>
	encodeSSEEvent(evt.type, evt.payload ?? {}),
);

function handleClientEventsStream(c: Context) {
	return createSSEResponse({
		signal: c.req.raw?.signal,
		initialChunk: encodeSSEComment('connected client-events'),
		heartbeat: {
			intervalMs: 5000,
			createChunk: () =>
				encodeEvent({
					type: 'heartbeat',
					payload: { createdAt: new Date().toISOString() },
				}),
		},
		onBackpressure(chunk) {
			logger.warn('[sse] dropping backpressured client event stream', {
				chunkBytes: chunk.byteLength,
			});
		},
		start({ send, onCleanup }) {
			onCleanup(subscribeClientEvents((evt) => send(encodeEvent(evt))));
		},
	});
}

export function registerClientEventsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/events/stream',
			operationId: 'subscribeClientEventsStream',
			tags: ['stream'],
			summary: 'Subscribe to global client event stream (SSE)',
			description:
				'App-level SSE stream for notifications and lightweight cross-session status updates.',
			request: {
				query: clientEventsQuerySchema,
			},
			responses: {
				'200': {
					description: 'text/event-stream',
					content: {
						'text/event-stream': {
							schema: clientEventsStreamSchema,
						},
					},
				},
			},
		},
		handleClientEventsStream,
	);
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/events/stream',
			operationId: 'subscribeClientEventsStreamPost',
			tags: ['stream'],
			summary: 'Subscribe to global client event stream (SSE) using POST',
			description:
				'Compatibility alias for app-level SSE over tunnels/proxies that do not support GET streams.',
			request: {
				query: clientEventsQuerySchema,
			},
			responses: {
				'200': {
					description: 'text/event-stream',
					content: {
						'text/event-stream': {
							schema: clientEventsStreamSchema,
						},
					},
				},
			},
		},
		handleClientEventsStream,
	);
}
