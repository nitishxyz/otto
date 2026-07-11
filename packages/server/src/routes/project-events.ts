import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import {
	subscribeClientEvents,
	subscribeProjectEvents,
} from '../events/bus.ts';
import type { ClientEvent, OttoEvent } from '../events/types.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	projectQuerySchema,
	resolveRequestProject,
} from './project-context.ts';

const STREAM_DESCRIPTION =
	'Multiplexed SSE stream carrying all session events for the project plus global client events over ONE connection. Session events have `data: {"sessionId": ..., "payload": {...}}`; client events have `data: {"payload": {...}}`.';

// desiredSize = highWaterMark - queued chunks; a large negative value means
// the consumer stopped reading. Treat the connection as stalled and drop it
// instead of buffering event data unboundedly (native memory growth).
const MAX_BACKPRESSURE_DEFICIT = -256;

const projectEventsStreamSchema = z.string().openapi({
	description: STREAM_DESCRIPTION,
});

function safeStringify(obj: unknown): string {
	return JSON.stringify(obj, (_key, value) =>
		typeof value === 'bigint' ? Number(value) : value,
	);
}

async function handleProjectEventsStream(c: Context) {
	const project = await resolveRequestProject(c);
	const headers = new Headers({
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});

	const encoder = new TextEncoder();

	let cleanedUp = false;
	let cleanup = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let unsubscribeProject = () => {};
			let unsubscribeLegacy = () => {};
			let unsubscribeClient = () => {};
			let hb: ReturnType<typeof setInterval> | null = null;

			cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (hb !== null) clearInterval(hb);
				unsubscribeProject();
				unsubscribeLegacy();
				unsubscribeClient();
				try {
					controller.close();
				} catch {}
			};

			const send = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk));
					if ((controller.desiredSize ?? 0) < MAX_BACKPRESSURE_DEFICIT) {
						cleanup();
					}
				} catch {
					cleanup();
				}
			};

			const writeSession = (evt: OttoEvent) => {
				if (evt.projectRoot && evt.projectRoot !== project.runtime.root) return;
				let line: string;
				try {
					line =
						`event: ${evt.type}\n` +
						`data: ${safeStringify({
							sessionId: evt.sessionId,
							payload: evt.payload ?? {},
						})}\n\n`;
				} catch {
					line = `event: ${evt.type}\ndata: {"sessionId":"${evt.sessionId}","payload":{}}\n\n`;
				}
				send(line);
			};

			const writeClient = (evt: ClientEvent) => {
				let line: string;
				try {
					line =
						`event: ${evt.type}\n` +
						`data: ${safeStringify({ payload: evt.payload ?? {} })}\n\n`;
				} catch {
					line = `event: ${evt.type}\ndata: {"payload":{}}\n\n`;
				}
				send(line);
			};

			unsubscribeProject = subscribeProjectEvents(
				project.runtime.root,
				writeSession,
			);
			unsubscribeLegacy = subscribeProjectEvents(undefined, writeSession);
			unsubscribeClient = subscribeClientEvents(writeClient);
			controller.enqueue(encoder.encode(': connected project-events\n\n'));
			hb = setInterval(() => {
				send(`: hb ${Date.now()}\n\n`);
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

export function registerProjectEventsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/events/project',
			operationId: 'subscribeProjectEventsStream',
			tags: ['stream'],
			summary: 'Subscribe to multiplexed project event stream (SSE)',
			description: STREAM_DESCRIPTION,
			request: {
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'text/event-stream',
					content: {
						'text/event-stream': {
							schema: projectEventsStreamSchema,
						},
					},
				},
			},
		},
		handleProjectEventsStream,
	);
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/events/project',
			operationId: 'subscribeProjectEventsStreamPost',
			tags: ['stream'],
			summary: 'Subscribe to multiplexed project event stream (SSE) using POST',
			description:
				'Compatibility alias for the project event stream over tunnels/proxies that do not support GET streams.',
			request: {
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'text/event-stream',
					content: {
						'text/event-stream': {
							schema: projectEventsStreamSchema,
						},
					},
				},
			},
		},
		handleProjectEventsStream,
	);
}
