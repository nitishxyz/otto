import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { getBusStats } from '../events/bus.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { getProjectManager } from '../runtime/projects/manager.ts';
import { getQueueStats } from '../runtime/session/queue/state.ts';

const startedAt = Date.now();

const debugRuntimeResponseSchema = z.object({
	pid: z.number().int(),
	uptimeSeconds: z.number(),
	memory: z.object({
		rssMb: z.number(),
		heapUsedMb: z.number(),
		heapTotalMb: z.number(),
		externalMb: z.number(),
		arrayBuffersMb: z.number(),
	}),
	bus: z.object({
		sessionKeys: z.number().int(),
		sessionSubscribers: z.number().int(),
		projectSubscribers: z.number().int(),
		clientSubscribers: z.number().int(),
		topSessionKeys: z.array(
			z.object({ key: z.string(), subscribers: z.number().int() }),
		),
	}),
	queue: z.object({
		runnerStates: z.number().int(),
		runningRunners: z.number().int(),
		queuedMessages: z.number().int(),
		messageAbortControllers: z.number().int(),
	}),
	projects: z.object({
		open: z.number().int(),
		items: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				lastUsedAt: z.number(),
			}),
		),
	}),
});

function toMb(bytes: number): number {
	return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export function registerDebugRuntimeRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/debug/runtime',
			tags: ['config'],
			operationId: 'getDebugRuntime',
			summary: 'Get daemon runtime diagnostics',
			description:
				'Live counters for SSE subscribers, session runners, open projects, and process memory. Intended for debugging daemon degradation without restarting.',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: debugRuntimeResponseSchema },
					},
				},
			},
		},
		(c) => {
			const memory = process.memoryUsage();
			const openProjects = getProjectManager().listOpenProjects();
			return c.json({
				pid: process.pid,
				uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
				memory: {
					rssMb: toMb(memory.rss),
					heapUsedMb: toMb(memory.heapUsed),
					heapTotalMb: toMb(memory.heapTotal),
					externalMb: toMb(memory.external ?? 0),
					arrayBuffersMb: toMb(memory.arrayBuffers ?? 0),
				},
				bus: getBusStats(),
				queue: getQueueStats(),
				projects: {
					open: openProjects.length,
					items: openProjects.map((project) => ({
						id: project.id,
						name: project.name,
						lastUsedAt: project.lastUsedAt,
					})),
				},
			});
		},
	);
}
