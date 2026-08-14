import { afterEach, describe, expect, test } from 'bun:test';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

afterEach(() => {
	globalThis.fetch = originalFetch;
	(globalThis as typeof globalThis & { window: Window }).window =
		originalWindow;
});

describe('project event stream multiplexer', () => {
	test('keeps one project stream while session subscriptions change', async () => {
		(globalThis as typeof globalThis & { window: Window }).window = {
			location: { search: '' },
			localStorage: {
				getItem: () => null,
				setItem: () => {},
				removeItem: () => {},
			},
			OTTO_SERVER_URL: 'http://127.0.0.1:4321',
			OTTO_RUNTIME_CONTEXT: {
				projectId: 'project-multiplexer-test',
				projectRoot: '/tmp/project-multiplexer-test',
				serverToken: 'test-token',
			},
		} as unknown as Window;

		const requests: string[] = [];
		globalThis.fetch = (async (input) => {
			requests.push(String(input));
			return new Response(': connected project-events\n\n', {
				headers: { 'content-type': 'text/event-stream' },
			});
		}) as typeof fetch;

		const { acquireClientEventStream, acquireSessionEventStream } =
			await import('../packages/web-sdk/src/lib/event-stream.ts');
		const client = acquireClientEventStream();
		const firstSession = acquireSessionEventStream('session-first');
		const secondSession = acquireSessionEventStream('session-second');

		await Bun.sleep(100);

		expect(requests).toEqual([
			'http://127.0.0.1:4321/v1/events/project?projectId=project-multiplexer-test',
		]);

		secondSession.release();
		firstSession.release();
		client.release();
	});
});
