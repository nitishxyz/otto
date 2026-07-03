import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import { subscribe } from '../events/bus.ts';
import type { OttoEvent } from '../events/types.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	projectQuerySchema,
	resolveRequestProject,
} from './project-context.ts';

const STREAM_DESCRIPTION =
	'SSE event stream. Events include session.created, message.created, message.part.delta, tool.call, tool.delta, tool.result, message.completed, error.';

// desiredSize = highWaterMark - queued chunks; a large negative value means
// the consumer stopped reading. Treat the connection as stalled and drop it
// instead of buffering event data unboundedly (native memory growth).
const MAX_BACKPRESSURE_DEFICIT = -256;

const sessionStreamParamsSchema = z.object({
	id: z.string().openapi({
		param: { name: 'id', in: 'path' },
	}),
});

const sessionStreamQuerySchema = projectQuerySchema;

const sessionStreamResponseSchema = z.string().openapi({
	description: STREAM_DESCRIPTION,
});

function safeStringify(obj: unknown): string {
	return JSON.stringify(obj, (_key, value) =>
		typeof value === 'bigint' ? Number(value) : value,
	);
}

async function handleSessionStream(c: Context) {
	const project = await resolveRequestProject(c);
	const sessionId = c.req.param('id');
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
				if (evt.projectRoot && evt.projectRoot !== project.runtime.root) return;
				let line: string;
				try {
					line =
						`event: ${evt.type}\n` +
						`data: ${safeStringify(evt.payload ?? {})}\n\n`;
				} catch {
					line = `event: ${evt.type}\ndata: {}\n\n`;
				}
				send(line);
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
			unsubscribeProject = subscribe(sessionId, write, project.runtime.root);
			unsubscribeLegacy = subscribe(sessionId, write);
			controller.enqueue(encoder.encode(`: connected ${sessionId}\n\n`));
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
