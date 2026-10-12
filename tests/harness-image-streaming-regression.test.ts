import { describe, expect, it, spyOn } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { boundToolEventValue } from '../packages/server/src/events/tool-payload';
import { encodeSSEEvent } from '../packages/server/src/events/sse';
import { ReadImageRenderer } from '../packages/web-sdk/src/components/messages/renderers/ReadImageRenderer';
import { startSessionStreamEngine } from '../packages/web-sdk/src/hooks/sessionStreamEngine';
import {
	fetchSessionMessages,
	getMessagesFromCache,
	updateMessagesCache,
} from '../packages/web-sdk/src/hooks/useMessages';
import { apiClient } from '../packages/web-sdk/src/lib/api-client';
import { getReadImageSource } from '../packages/web-sdk/src/lib/read-image';
import { setSSETransport } from '../packages/web-sdk/src/lib/sse-client';
import type {
	Message,
	MessagePart,
	MessagesPage,
} from '../packages/web-sdk/src/types/api';

// A complete SVG with the reported dimensions and a JPEG-sized payload exercises
// the real publisher's base64 bounding without relying on a browser image decoder.
const byteLength = 146_842;
const prefix =
	'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><!--';
const suffix = '--><rect width="1024" height="1536" fill="red"/></svg>';
const data = Buffer.from(
	prefix + 'x'.repeat(byteLength - prefix.length - suffix.length) + suffix,
).toString('base64');
const result = {
	ok: true,
	path: 'fixture.svg',
	mediaType: 'image/svg+xml',
	data,
	width: 1024,
	height: 1536,
	transmittedSize: byteLength,
	compressed: true,
};
const message: Message = {
	id: 'image-assistant',
	sessionId: 'image-session',
	role: 'assistant',
	status: 'pending',
	agent: 'build',
	provider: 'openai',
	model: 'fixture',
	createdAt: 1,
	completedAt: null,
	latencyMs: null,
	promptTokens: null,
	completionTokens: null,
	totalTokens: null,
	error: null,
	parts: [],
};
const persistedPart: MessagePart = {
	id: 'image-result',
	messageId: message.id,
	index: 1,
	stepIndex: 0,
	type: 'tool_result',
	content: JSON.stringify({ name: 'read_image', callId: 'image-call', result }),
	contentJson: { name: 'read_image', callId: 'image-call', result },
	agent: 'build',
	provider: 'openai',
	model: 'fixture',
	startedAt: 1,
	completedAt: 2,
	toolName: 'read_image',
	toolCallId: 'image-call',
	toolDurationMs: 1,
};
function page(parts: MessagePart[]): MessagesPage {
	return {
		items: [{ ...message, parts }],
		partCount: parts.length,
		hasMore: false,
		nextCursor: null,
	};
}
async function waitFor(check: () => boolean) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (check()) return;
		await Bun.sleep(5);
	}
	throw new Error('Timed out waiting for streaming fixture');
}

describe('live read_image hydration', () => {
	it('never renders publisher-truncated or short base64 as an image URL', () => {
		const bounded = boundToolEventValue(result);
		expect(bounded.truncated).toBe(true);
		expect((bounded.value as typeof result).data).toContain(
			'truncated for live stream',
		);
		expect(getReadImageSource(bounded.value)).toBeUndefined();
		expect(
			getReadImageSource({ ...result, data: data.slice(0, 24_000) }),
		).toBeUndefined();
		expect(getReadImageSource(result)).toBe(
			`data:image/svg+xml;base64,${data}`,
		);
		const html = renderToStaticMarkup(
			createElement(ReadImageRenderer, {
				contentJson: {
					name: 'read_image',
					result: bounded.value as typeof result,
				},
				isExpanded: true,
				onToggle: () => {},
			}),
		);
		expect(html).not.toContain('<img');
		expect(html).toContain('1024');
	});

	it('refetches full persisted bytes during Processing and preserves new live parts', async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		setSSETransport(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(value) {
							controller = value;
						},
					}),
					{ headers: { 'Content-Type': 'text/event-stream' } },
				),
		);
		let requests = 0;
		let completeRefetch: ((value: MessagesPage) => void) | undefined;
		const request = spyOn(apiClient, 'getMessagePage').mockImplementation(
			async () => {
				requests += 1;
				if (requests === 1) return page([]);
				return new Promise<MessagesPage>((resolve) => {
					completeRefetch = resolve;
				});
			},
		);
		let stop: (() => void) | undefined;
		try {
			await fetchSessionMessages(queryClient, message.sessionId);
			stop = startSessionStreamEngine({
				sessionId: message.sessionId,
				queryClient,
				isActive: () => false,
			});
			await waitFor(() => Boolean(controller));
			const send = (type: string, payload: unknown) =>
				controller?.enqueue(
					encodeSSEEvent(type, {
						type,
						sessionId: message.sessionId,
						payload,
					}),
				);
			send('tool.call', {
				name: 'read_image',
				callId: 'image-call',
				messageId: message.id,
				args: { path: result.path },
			});
			const bounded = boundToolEventValue(result);
			send('tool.result', {
				name: 'read_image',
				callId: 'image-call',
				messageId: message.id,
				result: bounded.value,
				resultTruncated: true,
			});
			await waitFor(() => Boolean(completeRefetch));
			const livePart: MessagePart = {
				...persistedPart,
				id: 'next-live-part',
				type: 'text',
				toolCallId: null,
				toolName: null,
				content: '{"text":"still streaming"}',
				contentJson: { text: 'still streaming' },
				ephemeral: true,
			};
			updateMessagesCache(queryClient, message.sessionId, (items) =>
				items.map((item) => ({ ...item, parts: [...item.parts, livePart] })),
			);
			completeRefetch?.(page([persistedPart]));
			await waitFor(
				() =>
					getMessagesFromCache(queryClient, message.sessionId)?.[0]?.parts.some(
						(part) => part.id === persistedPart.id,
					) === true,
			);
			const hydrated = getMessagesFromCache(
				queryClient,
				message.sessionId,
			)?.[0];
			expect(hydrated?.status).toBe('pending');
			expect(hydrated?.parts.map((part) => part.id)).toEqual([
				'image-result',
				'next-live-part',
			]);
			expect(
				getReadImageSource(
					(hydrated?.parts[0].contentJson as { result: unknown }).result,
				),
			).toBe(`data:image/svg+xml;base64,${data}`);
			expect(requests).toBe(2);

			// Transport-level omission has no usable tool result or session envelope.
			completeRefetch = undefined;
			controller?.enqueue(
				encodeSSEEvent('tool.result', {
					streamPayloadTruncated: true,
					streamPayloadOmitted: true,
				}),
			);
			await waitFor(() => Boolean(completeRefetch));
			completeRefetch?.(page([persistedPart]));
			expect(requests).toBe(3);
		} finally {
			stop?.();
			setSSETransport(undefined);
			request.mockRestore();
			queryClient.clear();
		}
	});
});
