import { z } from '@hono/zod-openapi';
import {
	submitBrowserControlResult,
	waitForBrowserControlCommand,
} from '@ottocode/sdk/browser-control';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { resolveRequestProjectRoot } from './project-context.ts';

const BROWSER_TAB_ID_PATTERN = /^browser:[A-Za-z0-9:_-]+$/;
const MAX_BROWSER_RESULT_LENGTH = 32 * 1024 * 1024;
const MAX_BROWSER_REQUEST_BYTES = 34 * 1024 * 1024;

const browserCommandSchema = z.object({
	id: z.string(),
	tabId: z.string(),
	action: z.string(),
	args: z.string(),
	createdAt: z.number(),
});

const pollBrowserCommandQuerySchema = z.object({
	tabId: z.string().max(128).regex(BROWSER_TAB_ID_PATTERN),
	url: z.string().max(8_192).optional(),
	title: z.string().max(512).optional(),
	kind: z.enum(['browser', 'simulator']).optional(),
});

const pollBrowserCommandResponseSchema = z.object({
	command: browserCommandSchema.nullable(),
});

const browserCommandResultBodySchema = z.object({
	result: z.string().max(MAX_BROWSER_RESULT_LENGTH),
});

const browserCommandResultResponseSchema = z.object({
	accepted: z.boolean(),
});

/** Registers the owner-only browser viewer command channel. */
export function registerBrowserRoutes(app: Hono) {
	app.use(
		'/v1/browser/*',
		bodyLimit({
			maxSize: MAX_BROWSER_REQUEST_BYTES,
			onError: (c) =>
				c.json({ error: 'Browser result payload is too large' }, 413),
		}),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/browser/commands',
			tags: ['browser'],
			operationId: 'pollBrowserCommand',
			summary: 'Wait for an agent command targeting a browser viewer tab',
			request: { query: pollBrowserCommandQuerySchema },
			responses: {
				'200': {
					description: 'The next command, or null after the poll timeout',
					content: {
						'application/json': { schema: pollBrowserCommandResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const tabId = c.req.query('tabId');
			if (!tabId) return c.json({ command: null }, 200);
			const projectRoot = await resolveRequestProjectRoot(c);
			const command = await waitForBrowserControlCommand(
				projectRoot,
				tabId,
				undefined,
				{
					url: c.req.query('url'),
					title: c.req.query('title'),
					kind: c.req.query('kind') as 'browser' | 'simulator' | undefined,
				},
			);
			const wireCommand = command
				? {
						id: command.id,
						tabId: command.tabId,
						action: command.action,
						args: JSON.stringify(command.args),
						createdAt: command.createdAt,
					}
				: null;
			return c.json(
				{
					command: wireCommand,
				},
				200,
			);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/browser/commands/{commandId}/result',
			tags: ['browser'],
			operationId: 'submitBrowserCommandResult',
			summary: 'Return the result of a browser viewer command',
			request: {
				params: z.object({ commandId: z.string().min(1) }),
				body: {
					required: true,
					content: {
						'application/json': { schema: browserCommandResultBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Whether the pending command accepted the result',
					content: {
						'application/json': { schema: browserCommandResultResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const commandId = c.req.param('commandId');
			const { result } =
				await c.req.json<z.infer<typeof browserCommandResultBodySchema>>();
			const projectRoot = await resolveRequestProjectRoot(c);
			let parsedResult: { ok: boolean; [key: string]: unknown } | null = null;
			try {
				const parsed: unknown = JSON.parse(result);
				if (
					parsed &&
					typeof parsed === 'object' &&
					!Array.isArray(parsed) &&
					typeof (parsed as { ok?: unknown }).ok === 'boolean'
				) {
					parsedResult = parsed as { ok: boolean; [key: string]: unknown };
				}
			} catch {}
			return c.json(
				{
					accepted: parsedResult
						? submitBrowserControlResult(projectRoot, commandId, parsedResult)
						: false,
				},
				200,
			);
		},
	);
}
