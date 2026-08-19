import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { getProtocolInfo } from '../protocol.ts';
import { getServerInfo } from '../state.ts';
import { isDaemonTokenAuthorized } from '../tunnel-auth.ts';
import {
	isDaemonRestartAvailable,
	requestDaemonRestart,
} from '../daemon-restart.ts';
import { resolveStagedDaemonUpgrade, stageDaemonUpgrade } from '../upgrade.ts';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	isOwnerSessionAuthorized,
	OWNER_SESSION_HEADER,
} from './tunnel/owner-auth.ts';

const rootResponseSchema = z.string();
const upgradeBodySchema = z.object({ targetVersion: z.string() });
const upgradeResponseSchema = z.object({
	status: z.literal('staged'),
	targetVersion: z.string(),
	stagedPath: z.string(),
	restartRequired: z.literal(true),
});
const restartBodySchema = z.object({ targetVersion: z.string().optional() });
const restartResponseSchema = z.object({
	status: z.literal('restarting'),
	targetVersion: z.string().nullable(),
});

const serverInfoSchema = z.object({
	port: z.number().nullable(),
	version: z.string().nullable(),
	pid: z.number(),
	daemonId: z.string().nullable(),
	startedAt: z.number(),
	protocol: z.object({
		version: z.number().int(),
		minVersion: z.number().int(),
		maxVersion: z.number().int(),
		capabilities: z.array(z.string()),
	}),
});

async function isDaemonHealthAuthorized(
	c: Parameters<Parameters<typeof zodOpenApiRoute>[2]>[0],
) {
	if (!process.env.OTTO_DAEMON_ID) return true;
	if (isOwnerSessionAuthorized(c.req.header(OWNER_SESSION_HEADER))) return true;
	return isDaemonTokenAuthorized(c);
}

export function registerRootRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/',
			tags: ['server'],
			operationId: 'getRoot',
			summary: 'Server health check',
			responses: {
				'200': {
					description: 'Server is running',
					content: {
						'text/plain': {
							schema: rootResponseSchema,
						},
					},
				},
			},
		},
		(c) => c.text('otto server running'),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/server/info',
			tags: ['server'],
			operationId: 'getServerInfo',
			summary: 'Get server runtime information',
			responses: {
				'200': {
					description: 'Server runtime metadata',
					content: {
						'application/json': {
							schema: serverInfoSchema,
						},
					},
				},
			},
		},
		async (c) => {
			if (!(await isDaemonHealthAuthorized(c))) {
				return c.json({ error: 'Unauthorized' }, 401);
			}
			return c.json({
				...getServerInfo(),
				protocol: getProtocolInfo(),
			});
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/server/upgrade',
			tags: ['server'],
			operationId: 'stageServerUpgrade',
			summary: 'Stage a newer official daemon release for owner restart',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: upgradeBodySchema } },
				},
			},
			responses: {
				'200': {
					description:
						'Upgrade staged; reconnect after an owner-managed restart',
					content: { 'application/json': { schema: upgradeResponseSchema } },
				},
			},
		},
		async (c) => {
			if (!isOwnerSessionAuthorized(c.req.header(OWNER_SESSION_HEADER))) {
				return c.json({ error: 'Owner authorization required' }, 403);
			}
			const { targetVersion } = c.req.valid('json');
			try {
				return c.json(
					await stageDaemonUpgrade(getServerInfo().version, targetVersion),
				);
			} catch (error) {
				return c.json(
					{ error: error instanceof Error ? error.message : String(error) },
					409,
				);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/server/restart',
			tags: ['server'],
			operationId: 'restartServer',
			summary: 'Restart the managed daemon with a supervised process handoff',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: restartBodySchema } },
				},
			},
			responses: {
				'202': {
					description: 'Supervised daemon restart queued',
					content: { 'application/json': { schema: restartResponseSchema } },
				},
			},
		},
		async (c) => {
			if (!isOwnerSessionAuthorized(c.req.header(OWNER_SESSION_HEADER))) {
				return c.json({ error: 'Owner authorization required' }, 403);
			}
			if (!isDaemonRestartAvailable()) {
				return c.json({ error: 'Supervised daemon restart unavailable' }, 409);
			}
			const { targetVersion } = c.req.valid('json');
			try {
				const executable = targetVersion
					? await resolveStagedDaemonUpgrade(
							getServerInfo().version,
							targetVersion,
						)
					: undefined;
				requestDaemonRestart({ executable, targetVersion });
				return c.json(
					{
						status: 'restarting' as const,
						targetVersion: targetVersion ?? null,
					},
					202,
				);
			} catch (error) {
				return c.json(
					{ error: error instanceof Error ? error.message : String(error) },
					409,
				);
			}
		},
	);
}
