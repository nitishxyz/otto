import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { upgradeWebSocket } from '../ws.ts';
import {
	createTerminal,
	createTerminalWebSocketHandler,
	getTerminal,
	handleTerminalOutput,
	killTerminal,
	listTerminals,
	resizeTerminal,
	sendTerminalInput,
} from './terminals/service.ts';
import { createTerminalWebSocketTicket } from './terminals/ws-ticket.ts';

const terminalSchema = z.object({
	id: z.string(),
	pid: z.number(),
	command: z.string(),
	args: z.array(z.string()),
	cwd: z.string(),
	purpose: z.string(),
	createdBy: z.enum(['user', 'llm']),
	title: z.string(),
	status: z.enum(['running', 'exited']),
	exitCode: z.number().optional(),
	createdAt: z.union([z.string(), z.date()]),
	uptime: z.number(),
});

const terminalIdParamsSchema = z.object({
	id: z.string().openapi({
		param: { name: 'id', in: 'path' },
	}),
});

const terminalCreateBodySchema = z.object({
	command: z.string().openapi({ description: 'Command to execute' }),
	args: z.array(z.string()).optional().openapi({
		description: 'Command arguments',
	}),
	purpose: z
		.string()
		.openapi({ description: 'Description of terminal purpose' }),
	cwd: z.string().optional().openapi({ description: 'Working directory' }),
	title: z.string().optional().openapi({ description: 'Terminal title' }),
});

const terminalInputBodySchema = z.object({
	input: z.string().openapi({ description: 'Input to send to terminal' }),
});

const terminalResizeBodySchema = z.object({
	cols: z.number().int().min(1),
	rows: z.number().int().min(1),
});

const terminalTicketResponseSchema = z.object({
	ticket: z.string(),
	expiresIn: z.number(),
});

const successResponseSchema = z.object({
	success: z.boolean(),
});

export function registerTerminalsRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/terminals/{id}/ws-ticket',
			operationId: 'createTerminalWebSocketTicket',
			summary: 'Create a one-time terminal WebSocket ticket',
			request: { params: terminalIdParamsSchema },
			responses: {
				'200': {
					description: 'One-time WebSocket ticket',
					content: {
						'application/json': { schema: terminalTicketResponseSchema },
					},
				},
			},
		},
		(c) => {
			const shareToken = c.req.header('X-Otto-Share-Token');
			return c.json(
				createTerminalWebSocketTicket({
					terminalId: c.req.param('id'),
					projectId:
						c.req.header('X-Otto-Share-Project-Id') ??
						c.req.header('X-Otto-Project-Id') ??
						c.req.query('projectId'),
					shareToken,
				}),
			);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/terminals',
			operationId: 'getTerminals',
			summary: 'List all terminals',
			description: 'Get a list of all active terminal sessions',
			responses: {
				'200': {
					description: 'List of terminals',
					content: {
						'application/json': {
							schema: z.object({
								terminals: z.array(terminalSchema),
								count: z.number().int(),
							}),
						},
					},
				},
			},
		},
		async (c) => c.json(await listTerminals(c)),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/terminals',
			operationId: 'postTerminals',
			summary: 'Create a new terminal',
			description: 'Spawn a new terminal process',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: terminalCreateBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Terminal created',
					content: {
						'application/json': {
							schema: z.object({
								terminalId: z.string(),
								pid: z.number().int(),
								purpose: z.string(),
								command: z.string(),
							}),
						},
					},
				},
			},
		},
		(c) => createTerminal(c),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/terminals/{id}',
			operationId: 'getTerminalsById',
			summary: 'Get terminal details',
			description: 'Get information about a specific terminal',
			request: { params: terminalIdParamsSchema },
			responses: {
				'200': {
					description: 'Terminal details',
					content: {
						'application/json': {
							schema: z.object({ terminal: terminalSchema }),
						},
					},
				},
				'404': { description: 'Terminal not found' },
			},
		},
		(c) => getTerminal(c),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/terminals/{id}/ws',
			operationId: 'connectTerminalWebSocket',
			summary: 'Connect to terminal WebSocket',
			description:
				'Upgrade to a WebSocket for bidirectional terminal I/O. Generated HTTP clients cannot consume the upgraded connection directly.',
			request: { params: terminalIdParamsSchema },
			responses: {
				'101': { description: 'WebSocket upgrade accepted' },
				'404': { description: 'Terminal not found' },
			},
		},
		upgradeWebSocket((c) => createTerminalWebSocketHandler(c)),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/terminals/{id}/output',
			operationId: 'getTerminalsByIdOutput',
			summary: 'Stream terminal output',
			description: 'Get real-time terminal output via SSE',
			request: { params: terminalIdParamsSchema },
			responses: {
				'200': {
					description: 'SSE stream of terminal output',
					content: {
						'text/event-stream': { schema: z.string() },
					},
				},
			},
		},
		(c) => handleTerminalOutput(c),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/terminals/{id}/output',
			operationId: 'postTerminalsByIdOutput',
			summary: 'Stream terminal output using POST',
			description: 'Compatibility alias for terminal output SSE',
			request: { params: terminalIdParamsSchema },
			responses: {
				'200': {
					description: 'SSE stream of terminal output',
					content: {
						'text/event-stream': { schema: z.string() },
					},
				},
			},
		},
		(c) => handleTerminalOutput(c),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/terminals/{id}/input',
			operationId: 'postTerminalsByIdInput',
			summary: 'Send input to terminal',
			description: 'Write data to terminal stdin',
			request: {
				params: terminalIdParamsSchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: terminalInputBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Input sent',
					content: {
						'application/json': { schema: successResponseSchema },
					},
				},
			},
		},
		(c) => sendTerminalInput(c),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/terminals/{id}',
			operationId: 'deleteTerminalsById',
			summary: 'Kill terminal',
			description: 'Terminate a running terminal process',
			request: { params: terminalIdParamsSchema },
			responses: {
				'200': {
					description: 'Terminal killed',
					content: {
						'application/json': { schema: successResponseSchema },
					},
				},
			},
		},
		(c) => killTerminal(c),
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/terminals/{id}/resize',
			operationId: 'resizeTerminal',
			summary: 'Resize terminal',
			description: 'Resize the pseudo-terminal dimensions.',
			request: {
				params: terminalIdParamsSchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: terminalResizeBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'Terminal resized',
					content: {
						'application/json': { schema: successResponseSchema },
					},
				},
				'400': { description: 'Invalid terminal size' },
				'404': { description: 'Terminal not found' },
			},
		},
		(c) => resizeTerminal(c),
	);
}
