import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import { subscribeClientEvents } from '../events/bus.ts';
import type { ClientEvent } from '../events/types.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';

const STREAM_DESCRIPTION =
	'SSE event stream. Events include notification, session.status, and heartbeat.';

const MAX_BACKPRESSURE_DEFICIT = -256;

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

function safeStringify(obj: unknown): string {
	return JSON.stringify(obj, (_key, value) =>
		typeof value === 'bigint' ? Number(value) : value,
	);
}

function handleClientEventsStream(c: Context) {
	const headers = new Headers({
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
	});

	const encoder = new TextEncoder();

	let cleanedUp = false;
	let cleanup = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let unsubscribe = () => {};
			let hb: ReturnType<typeof setInterval> | null = null;

			cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (hb !== null) clearInterval(hb);
				unsubscribe();
				try {
					controller.close();
				} catch {}
			};

			const write = (evt: ClientEvent) => {
				let line: string;
				try {
					line =
						`event: ${evt.type}\n` +
						`data: ${safeStringify(evt.payload ?? {})}\n\n`;
				} catch {
					line = `event: ${evt.type}\ndata: {}\n\n`;
				}
				try {
					controller.enqueue(encoder.encode(line));
					if ((controller.desiredSize ?? 0) < MAX_BACKPRESSURE_DEFICIT) {
						cleanup();
					}
				} catch {
					cleanup();
				}
			};

			unsubscribe = subscribeClientEvents(write);
			controller.enqueue(encoder.encode(': connected client-events\n\n'));
			hb = setInterval(() => {
				write({
					type: 'heartbeat',
					payload: { createdAt: new Date().toISOString() },
				});
			}, 5000);

			const signal = c.req.raw?.signal as AbortSignal | undefined;
			signal?.addEventListener('abort', cleanup, { once: true });
		},
		cancel() {
			cleanup();
		},
	});

	return new Response(stream, { headers });
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
