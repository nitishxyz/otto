import type { Hono } from 'hono';
import type { TerminalManager } from '@ottocode/sdk';
import { upgradeWebSocket } from '../ws.ts';
import { openApiRoute } from '../openapi/route.ts';
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

export function registerTerminalsRoutes(
	app: Hono,
	terminalManager: TerminalManager,
) {
	openApiRoute(
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
							schema: {
								type: 'object',
								properties: {
									terminals: {
										type: 'array',
										items: {
											$ref: '#/components/schemas/Terminal',
										},
									},
									count: {
										type: 'integer',
									},
								},
							},
						},
					},
				},
			},
		},
		(c) => c.json(listTerminals(terminalManager)),
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/terminals',
			operationId: 'postTerminals',
			summary: 'Create a new terminal',
			description: 'Spawn a new terminal process',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							required: ['command', 'purpose'],
							properties: {
								command: {
									type: 'string',
									description: 'Command to execute',
								},
								args: {
									type: 'array',
									items: {
										type: 'string',
									},
									description: 'Command arguments',
								},
								purpose: {
									type: 'string',
									description: 'Description of terminal purpose',
								},
								cwd: {
									type: 'string',
									description: 'Working directory',
								},
								title: {
									type: 'string',
									description: 'Terminal title',
								},
							},
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'Terminal created',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									terminalId: {
										type: 'string',
									},
									pid: {
										type: 'integer',
									},
									purpose: {
										type: 'string',
									},
									command: {
										type: 'string',
									},
								},
							},
						},
					},
				},
			},
		},
		(c) => createTerminal(c, terminalManager),
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/terminals/{id}',
			operationId: 'getTerminalsById',
			summary: 'Get terminal details',
			description: 'Get information about a specific terminal',
			parameters: [
				{
					name: 'id',
					in: 'path',
					required: true,
					schema: {
						type: 'string',
					},
				},
			],
			responses: {
				'200': {
					description: 'Terminal details',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									terminal: {
										$ref: '#/components/schemas/Terminal',
									},
								},
							},
						},
					},
				},
				'404': {
					description: 'Terminal not found',
				},
			},
		},
		(c) => getTerminal(c, terminalManager),
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/terminals/{id}/ws',
			operationId: 'connectTerminalWebSocket',
			summary: 'Connect to terminal WebSocket',
			description:
				'Upgrade to a WebSocket for bidirectional terminal I/O. Generated HTTP clients cannot consume the upgraded connection directly.',
			parameters: [
				{
					name: 'id',
					in: 'path',
					required: true,
					schema: { type: 'string' },
				},
			],
			responses: {
				'101': { description: 'WebSocket upgrade accepted' },
				'404': { description: 'Terminal not found' },
			},
		},
		upgradeWebSocket((c) => {
			const id = c.req.param('id');
			return createTerminalWebSocketHandler(terminalManager, id);
		}),
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/terminals/{id}/output',
			operationId: 'getTerminalsByIdOutput',
			summary: 'Stream terminal output',
			description: 'Get real-time terminal output via SSE',
			parameters: [
				{
					name: 'id',
					in: 'path',
					required: true,
					schema: {
						type: 'string',
					},
				},
			],
			responses: {
				'200': {
					description: 'SSE stream of terminal output',
					content: {
						'text/event-stream': {
							schema: {
								type: 'string',
							},
						},
					},
				},
			},
		},
		(c) => handleTerminalOutput(c, terminalManager),
	);
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/terminals/{id}/output',
			operationId: 'postTerminalsByIdOutput',
			summary: 'Stream terminal output using POST',
			description: 'Compatibility alias for terminal output SSE',
			parameters: [
				{
					name: 'id',
					in: 'path',
					required: true,
					schema: { type: 'string' },
				},
			],
			responses: {
				'200': {
					description: 'SSE stream of terminal output',
					content: {
						'text/event-stream': {
							schema: { type: 'string' },
						},
					},
				},
			},
		},
		(c) => handleTerminalOutput(c, terminalManager),
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/terminals/{id}/input',
			operationId: 'postTerminalsByIdInput',
			summary: 'Send input to terminal',
			description: 'Write data to terminal stdin',
			parameters: [
				{
					name: 'id',
					in: 'path',
					required: true,
					schema: {
						type: 'string',
					},
				},
			],
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							required: ['input'],
							properties: {
								input: {
									type: 'string',
									description: 'Input to send to terminal',
								},
							},
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'Input sent',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									success: {
										type: 'boolean',
									},
								},
							},
						},
					},
				},
			},
		},
		(c) => sendTerminalInput(c, terminalManager),
	);

	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/terminals/{id}',
			operationId: 'deleteTerminalsById',
			summary: 'Kill terminal',
			description: 'Terminate a running terminal process',
			parameters: [
				{
					name: 'id',
					in: 'path',
					required: true,
					schema: {
						type: 'string',
					},
				},
			],
			responses: {
				'200': {
					description: 'Terminal killed',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									success: {
										type: 'boolean',
									},
								},
							},
						},
					},
				},
			},
		},
		(c) => killTerminal(c, terminalManager),
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/terminals/{id}/resize',
			operationId: 'resizeTerminal',
			summary: 'Resize terminal',
			description: 'Resize the pseudo-terminal dimensions.',
			parameters: [
				{
					name: 'id',
					in: 'path',
					required: true,
					schema: { type: 'string' },
				},
			],
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							required: ['cols', 'rows'],
							properties: {
								cols: { type: 'integer', minimum: 1 },
								rows: { type: 'integer', minimum: 1 },
							},
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'Terminal resized',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['success'],
								properties: { success: { type: 'boolean' } },
							},
						},
					},
				},
				'400': { description: 'Invalid terminal size' },
				'404': { description: 'Terminal not found' },
			},
		},
		(c) => resizeTerminal(c, terminalManager),
	);
}
