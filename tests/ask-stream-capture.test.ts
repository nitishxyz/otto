import { describe, expect, test, mock } from 'bun:test';
import { runAskStreamCapture } from '@ottocode/cli/src/ask/capture.ts';

const encoder = new TextEncoder();

function createSSE(events: string[]) {
	return new Response(
		new ReadableStream({
			start(controller) {
				for (const event of events) {
					controller.enqueue(encoder.encode(event));
				}
				controller.close();
			},
		}),
		{ headers: { 'Content-Type': 'text/event-stream' } },
	);
}

describe('runAskStreamCapture', () => {
	test('sends prompt payload and streams output', async () => {
		const originalFetch = globalThis.fetch;
		const originalWrite = Bun.write;
		const prevServerUrl = process.env.OTTO_SERVER_URL;
		process.env.OTTO_SERVER_URL = 'http://example.com';

		let requestBody: string | undefined;
		const handshake = {
			sessionId: 'session-2',
			header: { sessionId: 'session-2' },
			provider: 'openai',
			model: 'gpt-4o',
			agent: 'default',
			assistantMessageId: 'assistant-2',
		};

		const fetchMock = mock(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const url =
					typeof input === 'string'
						? input
						: input instanceof URL
							? input.toString()
							: input.url;
				if (url.includes('/v1/projects/open')) {
					return new Response(
						JSON.stringify({ id: 'project-id', path: '/tmp/project' }),
						{ headers: { 'Content-Type': 'application/json' } },
					);
				}
				if (url.includes('/v1/ask')) {
					requestBody =
						input instanceof Request
							? await input.clone().text()
							: String(init?.body ?? '');
					return new Response(JSON.stringify(handshake), {
						headers: { 'Content-Type': 'application/json' },
					});
				}
				if (url.includes('/stream')) {
					const deltaEvent =
						`event: message.part.delta\n` +
						'data: {"messageId":"assistant-2","delta":"chunk"}\n\n';
					const completedEvent =
						'event: message.completed\n' + 'data: {"id":"assistant-2"}\n\n';
					return createSSE([deltaEvent, completedEvent]);
				}
				throw new Error(`Unexpected fetch url: ${url}`);
			},
		);

		const writeMock = mock(() => Promise.resolve(0));
		// @ts-expect-error override for testing
		Bun.write = writeMock;
		globalThis.fetch = fetchMock as typeof fetch;

		try {
			const result = await runAskStreamCapture('Stream me', {
				project: '/tmp/project',
			});
			expect(result.sessionId).toBe('session-2');
			expect(result.text).toBe('chunk');

			const parsed = JSON.parse(requestBody ?? '{}');
			expect(parsed.prompt).toBe('Stream me');
			expect(parsed.content).toBeUndefined();
		} finally {
			globalThis.fetch = originalFetch;
			// @ts-expect-error restore implementation
			Bun.write = originalWrite;
			if (prevServerUrl === undefined) delete process.env.OTTO_SERVER_URL;
			else process.env.OTTO_SERVER_URL = prevServerUrl;
		}
	});
});
