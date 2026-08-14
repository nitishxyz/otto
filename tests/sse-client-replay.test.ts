import { afterEach, describe, expect, test } from 'bun:test';
import { SSEClient } from '../packages/web-sdk/src/lib/sse-client.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('SSEClient replay cursor', () => {
	test('sends Last-Event-ID and advances it from parsed events', async () => {
		let requestLastEventId: string | null = null;
		globalThis.fetch = (async (_input, init) => {
			requestLastEventId = new Headers(init?.headers).get('last-event-id');
			return new Response(
				'id: 18\nevent: message.created\ndata: {"payload":{"id":"m-18"}}\n\n',
				{ headers: { 'content-type': 'text/event-stream' } },
			);
		}) as typeof fetch;

		const client = new SSEClient();
		client.setLastEventId('17');
		let receivedId: string | undefined;
		client.on('*', (event) => {
			receivedId = event.id;
			client.disconnect();
		});
		await client.connect('http://localhost:9100/v1/events/project');

		expect(requestLastEventId).toBe('17');
		expect(receivedId).toBe('18');
		expect(client.getLastEventId()).toBe('18');
	});
});
