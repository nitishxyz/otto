import type { Context } from 'hono';
import type { Hono } from 'hono';
import { subscribeClientEvents } from '../events/bus.ts';
import type { ClientEvent } from '../events/types.ts';
import { openApiRoute } from '../openapi/route.ts';

const STREAM_DESCRIPTION =
	'SSE event stream. Events include notification, session.status, and heartbeat.';

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

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const write = (evt: ClientEvent) => {
				let line: string;
				try {
					line =
						`event: ${evt.type}\n` +
						`data: ${safeStringify(evt.payload ?? {})}\n\n`;
				} catch {
					line = `event: ${evt.type}\ndata: {}\n\n`;
				}
				controller.enqueue(encoder.encode(line));
			};

			const unsubscribe = subscribeClientEvents(write);
			controller.enqueue(encoder.encode(': connected client-events\n\n'));
			const hb = setInterval(() => {
				try {
					write({
						type: 'heartbeat',
						payload: { createdAt: new Date().toISOString() },
					});
				} catch {
					clearInterval(hb);
				}
			}, 5000);

			const signal = c.req.raw?.signal as AbortSignal | undefined;
			signal?.addEventListener('abort', () => {
				clearInterval(hb);
				unsubscribe();
				try {
					controller.close();
				} catch {}
			});
		},
	});

	return new Response(stream, { headers });
}

export function registerClientEventsRoute(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/events/stream',
			operationId: 'subscribeClientEventsStream',
			tags: ['stream'],
			summary: 'Subscribe to global client event stream (SSE)',
			description:
				'App-level SSE stream for notifications and lightweight cross-session status updates.',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: { type: 'string' },
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			responses: {
				'200': {
					description: 'text/event-stream',
					content: {
						'text/event-stream': {
							schema: {
								type: 'string',
								description: STREAM_DESCRIPTION,
							},
						},
					},
				},
			},
		},
		handleClientEventsStream,
	);
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/events/stream',
			operationId: 'subscribeClientEventsStreamPost',
			tags: ['stream'],
			summary: 'Subscribe to global client event stream (SSE) using POST',
			description:
				'Compatibility alias for app-level SSE over tunnels/proxies that do not support GET streams.',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: { type: 'string' },
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			responses: {
				'200': {
					description: 'text/event-stream',
					content: {
						'text/event-stream': {
							schema: {
								type: 'string',
								description: STREAM_DESCRIPTION,
							},
						},
					},
				},
			},
		},
		handleClientEventsStream,
	);
}
