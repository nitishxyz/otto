import type { OpenAPIHono } from '@hono/zod-openapi';

export function registerOpenApiRoute(app: OpenAPIHono) {
	app.doc('/openapi.json', {
		openapi: '3.0.3',
		info: {
			title: 'otto server API',
			version: '0.1.0',
			description:
				'Server-side API for otto sessions, messages, and streaming events. All AI work runs on the server. Streaming uses SSE.',
		},
		tags: [
			{ name: 'projects' },
			{ name: 'sessions' },
			{ name: 'messages' },
			{ name: 'stream' },
			{ name: 'ask' },
			{ name: 'config' },
			{ name: 'files' },
			{ name: 'git' },
			{ name: 'terminals' },
			{ name: 'ottorouter' },
			{ name: 'auth' },
			{ name: 'github' },
			{ name: 'mcp' },
			{ name: 'tunnel' },
			{ name: 'plugins' },
		],
	});
}
