import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import {
	subscribeClientEvents,
	subscribeProjectEvents,
} from '../events/bus.ts';
import {
	createSSEByteStrategy,
	encodeSSEComment,
	encodeSSEEvent,
	SSE_QUEUE_HIGH_WATER_MARK_BYTES,
	trackProjectSSEStream,
} from '../events/sse.ts';
import type { ClientEvent, OttoEvent } from '../events/types.ts';
import {
	getProjectReplay,
	type ProjectReplayRecord,
} from '../events/project-replay.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	projectQuerySchema,
	resolveRequestProject,
} from './project-context.ts';

const STREAM_DESCRIPTION =
	'Multiplexed SSE stream carrying all session events for the project plus client events such as notifications, session status, and reference preparation over ONE connection. Session events have `data: {"sessionId": ..., "payload": {...}}`; client events have `data: {"payload": {...}}`.';

const projectEventsStreamSchema = z.string().openapi({
	description: STREAM_DESCRIPTION,
});
const projectEventsQuerySchema = projectQuerySchema.extend({
	sessions: z.string().optional().openapi({
		description:
			'Comma-separated session ids to include. Omit for all sessions; pass an empty value for client events only.',
	}),
});

async function handleProjectEventsStream(c: Context) {
	const project = await resolveRequestProject(c);
	const releaseProject = project.runtime.retain();
	const lastEventId = c.req.header('last-event-id');
	const sessionsParam = c.req.query('sessions');
	const sessionFilter =
		sessionsParam === undefined
			? null
			: new Set(sessionsParam.split(',').filter(Boolean));
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
				let unsubscribeProjectRoot = () => {};
				let unsubscribeProjectId = () => {};
				let unsubscribeLegacy = () => {};
				let unsubscribeClient = () => {};
				let hb: ReturnType<typeof setInterval> | null = null;

				cleanup = () => {
					if (cleanedUp) return;
					cleanedUp = true;
					if (hb !== null) clearInterval(hb);
					unsubscribeProjectRoot();
					unsubscribeProjectId();
					unsubscribeLegacy();
					unsubscribeClient();
					metrics.close();
					releaseProject();
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
							logger.warn('[sse] dropping backpressured project stream', {
								projectId: project.projectId,
								projectRoot: project.projectRoot,
								chunkBytes: chunk.byteLength,
							});
							cleanup();
						}
					} catch {
						cleanup();
					}
				};

				const acceptsSession = (evt: {
					projectId?: string;
					projectRoot?: string;
					sessionId: string;
				}) => {
					if (evt.projectId && evt.projectId !== project.projectId) return;
					if (evt.projectRoot && evt.projectRoot !== project.runtime.root)
						return;
					if (sessionFilter && !sessionFilter.has(evt.sessionId)) return;
					return true;
				};

				const writeSession = (evt: OttoEvent, replay: ProjectReplayRecord) => {
					if (!acceptsSession(evt)) return;
					send(replay.chunk);
				};

				const acceptsClient = (evt: ClientEvent) => {
					const payload = evt.payload;
					if (
						'projectId' in payload &&
						payload.projectId &&
						payload.projectId !== project.projectId
					) {
						return false;
					}
					if (
						'projectRoot' in payload &&
						payload.projectRoot &&
						payload.projectRoot !== project.projectRoot
					) {
						return false;
					}
					return true;
				};

				const writeClient = (evt: ClientEvent, replay: ProjectReplayRecord) => {
					if (!acceptsClient(evt)) return;
					send(replay.chunk);
				};

				unsubscribeProjectRoot = subscribeProjectEvents(
					project.runtime.root,
					writeSession,
				);
				unsubscribeProjectId = subscribeProjectEvents(
					project.projectId,
					writeSession,
				);
				unsubscribeLegacy = subscribeProjectEvents(undefined, writeSession);
				unsubscribeClient = subscribeClientEvents(writeClient);
				if (lastEventId) {
					const replay = getProjectReplay(
						[project.runtime.root, project.projectId, undefined],
						lastEventId,
					);
					for (const record of replay.records) {
						if (
							record.kind === 'session' &&
							acceptsSession({
								projectId: record.projectId,
								projectRoot: record.projectRoot,
								sessionId: record.sessionId ?? '',
							})
						) {
							send(record.chunk);
						} else if (record.kind === 'client') {
							const projectMatches =
								(!record.projectId || record.projectId === project.projectId) &&
								(!record.projectRoot ||
									record.projectRoot === project.projectRoot);
							if (projectMatches) send(record.chunk);
						}
					}
					if (replay.missed) {
						send(
							encodeSSEEvent('stream.replay.missed', {
								payload: { lastEventId },
							}),
						);
					}
				}
				send(encodeSSEComment('connected project-events'));
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
				query: projectEventsQuerySchema,
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
				query: projectEventsQuerySchema,
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
