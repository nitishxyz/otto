import { expect, it } from 'bun:test';

it('forwards HTTP poll cancellation to the browser broker', async () => {
	const script = `
		import { mock, expect } from 'bun:test';
		import { OpenAPIHono } from '@hono/zod-openapi';
		const projectRoot = 'browser-route-abort-' + crypto.randomUUID();
		mock.module('./packages/server/src/routes/project-context.ts', () => ({
			resolveRequestProjectRoot: async () => projectRoot,
		}));
		const { registerBrowserRoutes } = await import('./packages/server/src/routes/browser.ts');
		const { listBrowserViewers, requestBrowserControl, submitBrowserControlResult } = await import('./packages/sdk/src/browser-control.ts');
		const app = new OpenAPIHono();
		registerBrowserRoutes(app);
		const controller = new AbortController();
		const url = 'http://localhost/v1/browser/commands?tabId=browser:browser';
		const abandoned = app.request(new Request(url, { signal: controller.signal }));
		for (let attempt = 0; attempt < 100 && !listBrowserViewers(projectRoot).length; attempt++) {
			await Bun.sleep(1);
		}
		expect(listBrowserViewers(projectRoot)).toHaveLength(1);
		controller.abort();
		const aborted = await Promise.race([abandoned, Bun.sleep(500).then(() => null)]);
		expect(aborted).not.toBeNull();
		expect(await aborted.json()).toEqual({ command: null });
		const live = app.request(url);
		const result = requestBrowserControl({ projectRoot, tabId: 'browser:browser', action: 'snapshot', args: {} }, 500);
		const response = await live;
		const { command } = await response.json();
		expect(command.action).toBe('snapshot');
		expect(submitBrowserControlResult(projectRoot, command.id, { ok: true })).toBe(true);
		expect(await result).toEqual({ ok: true });
		process.exit(0);
	`;
	const process = Bun.spawn([Bun.which('bun') ?? 'bun', '-e', script], {
		cwd: new URL('..', import.meta.url).pathname,
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [code, stderr] = await Promise.all([
		process.exited,
		new Response(process.stderr).text(),
	]);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});
