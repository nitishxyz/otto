import { z } from '@hono/zod-openapi';
import type { Context, Hono } from 'hono';
import {
	subscribeClientEvents,
	subscribeDesktopEvents,
} from '../events/bus.ts';
import { getDesktopReplay } from '../events/project-replay.ts';
import {
	createSSEByteStrategy,
	encodeSSEComment,
	encodeSSEEvent,
	SSE_QUEUE_HIGH_WATER_MARK_BYTES,
	trackProjectSSEStream,
} from '../events/sse.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { isDaemonTokenAuthorized } from '../tunnel-auth.ts';

const desktopEventsStreamSchema = z.string().openapi({
	description:
		'Daemon-wide SSE stream used by the native desktop broker. Every event includes project routing metadata when available.',
});

async function handleDesktopEventsStream(c: Context) {
	if (!(await isDaemonTokenAuthorized(c))) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	const lastEventId = c.req.header('last-event-id');
	const headers = new Headers({
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	let cleanedUp = false;
	let cleanup = () => {};
	const metrics = trackProjectSSEStream();

	const stream = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				let unsubscribeSessions = () => {};
				let unsubscribeClient = () => {};
				let heartbeat: ReturnType<typeof setInterval> | null = null;
				cleanup = () => {
					if (cleanedUp) return;
					cleanedUp = true;
					if (heartbeat !== null) clearInterval(heartbeat);
					unsubscribeSessions();
					unsubscribeClient();
					metrics.close();
					try {
						controller.close();
					} catch {}
				};

				const send = (chunk: Uint8Array) => {
					try {
						controller.enqueue(chunk);
						metrics.updateQueued(
							SSE_QUEUE_HIGH_WATER_MARK_BYTES -
								(controller.desiredSize ?? SSE_QUEUE_HIGH_WATER_MARK_BYTES),
						);
						if ((controller.desiredSize ?? 0) < 0) {
							metrics.markDropped();
							cleanup();
						}
					} catch {
						cleanup();
					}
				};

				unsubscribeSessions = subscribeDesktopEvents((_event, replay) => {
					send(replay.chunk);
				});
				unsubscribeClient = subscribeClientEvents((_event, replay) => {
					send(replay.chunk);
				});

				if (lastEventId) {
					const replay = getDesktopReplay(lastEventId);
					for (const record of replay.records) send(record.chunk);
					if (replay.missed) {
						send(
							encodeSSEEvent('stream.replay.missed', {
								payload: { lastEventId },
							}),
						);
					}
				}

				send(encodeSSEComment('connected desktop-events'));
				heartbeat = setInterval(() => {
					send(encodeSSEComment(`hb ${Date.now()}`));
				}, 5000);
				c.req.raw.signal.addEventListener('abort', cleanup, { once: true });
			},
			cancel() {
				cleanup();
			},
		},
		createSSEByteStrategy(),
	);

	return new Response(stream, { headers });
}

export function registerDesktopEventsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/events/desktop',
			operationId: 'subscribeDesktopEventsStream',
			tags: ['stream'],
			summary: 'Subscribe to daemon-wide desktop events (SSE)',
			description:
				'Native desktop-only event stream covering every open project. Requires the daemon server token.',
			responses: {
				'200': {
					description: 'text/event-stream',
					content: {
						'text/event-stream': { schema: desktopEventsStreamSchema },
					},
				},
				'401': { description: 'Unauthorized' },
			},
		},
		handleDesktopEventsStream,
	);
}
