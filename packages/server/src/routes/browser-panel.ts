import type { Hono } from 'hono';
import {
	completeBrowserPanelCommand,
	drainBrowserPanelCommands,
	getBrowserPanelState,
	updateBrowserPanelState,
} from '@ottocode/sdk';
import { openApiRoute } from '../openapi/route.ts';

export function registerBrowserPanelRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/browser-panel/commands',
			tags: ['browser-panel'],
			operationId: 'drainBrowserPanelCommands',
			summary: 'Drain pending Browser panel commands',
			responses: {
				'200': {
					description: 'Pending commands for the Browser panel',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									commands: { type: 'array', items: { type: 'object' } },
								},
								required: ['commands'],
							},
						},
					},
				},
			},
		},
		(c) => c.json({ commands: drainBrowserPanelCommands() }),
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/browser-panel/state',
			tags: ['browser-panel'],
			operationId: 'getBrowserPanelState',
			summary: 'Get current Browser panel state',
			responses: {
				'200': {
					description: 'Current Browser panel state',
					content: {
						'application/json': {
							schema: { type: 'object' },
						},
					},
				},
			},
		},
		(c) => c.json(getBrowserPanelState()),
	);

	app.post('/v1/browser-panel/state', async (c) => {
		const body = await c.req.json();
		return c.json(updateBrowserPanelState(body));
	});

	app.post('/v1/browser-panel/command-results', async (c) => {
		const body = await c.req.json();
		return c.json(completeBrowserPanelCommand(body));
	});
}
