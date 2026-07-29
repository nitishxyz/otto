import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it } from 'bun:test';
import { registerBrowserRoutes } from '../packages/server/src/routes/browser.ts';

describe('browser routes', () => {
	it('rejects oversized command results before parsing JSON', async () => {
		const app = new OpenAPIHono();
		registerBrowserRoutes(app);

		const response = await app.request(
			'http://localhost/v1/browser/commands/test/result',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': String(35 * 1024 * 1024),
				},
				body: '{}',
			},
		);

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: 'Browser result payload is too large',
		});
	});
});
