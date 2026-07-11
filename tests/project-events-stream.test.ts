import { describe, expect, it } from 'bun:test';
import { createApp } from '@ottocode/server';
import {
	publish,
	publishClientEvent,
} from '../packages/server/src/events/bus.ts';

const app = createApp();

interface ParsedEvent {
	event: string;
	data: Record<string, unknown>;
}

// Invoke the Hono app directly instead of going through a real socket and
// global fetch: several suites stub globalThis.fetch (oauth clients) and
// bun's pattern-discovery mode interleaves module loading, which poisoned
// network-based reads when the whole tests/ directory ran together.
async function openStream(path: string, method: 'GET' | 'POST' = 'GET') {
	const abort = new AbortController();
	const response = await app.fetch(
		new Request(`http://localhost${path}`, { method, signal: abort.signal }),
	);
	expect(response.ok).toBe(true);
	const reader = response.body?.getReader();
	if (!reader) throw new Error('No response body');
	const decoder = new TextDecoder();
	let buffer = '';

	const next = async (
		match: (evt: ParsedEvent) => boolean,
		timeoutMs = 3000,
	): Promise<ParsedEvent> => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			let idx = buffer.indexOf('\n\n');
			while (idx !== -1) {
				const raw = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				let event = 'message';
				let data = '';
				for (const line of raw.split('\n')) {
					if (line.startsWith('event: ')) event = line.slice(7).trim();
					else if (line.startsWith('data: ')) data += line.slice(6);
				}
				if (data) {
					const parsed: ParsedEvent = { event, data: JSON.parse(data) };
					if (match(parsed)) return parsed;
				}
				idx = buffer.indexOf('\n\n');
			}
			const chunk = await Promise.race([
				reader.read(),
				new Promise<null>((resolve) =>
					setTimeout(() => resolve(null), deadline - Date.now()),
				),
			]);
			if (!chunk || chunk.done) break;
			buffer += decoder.decode(chunk.value, { stream: true });
		}
		throw new Error('Timed out waiting for event');
	};

	return {
		headers: response.headers,
		next,
		close: async () => {
			abort.abort();
			await reader.cancel().catch(() => {});
		},
	};
}

describe('multiplexed project events stream', () => {
	it('carries session events with a sessionId envelope', async () => {
		const stream = await openStream(
			`/v1/events/project?project=${encodeURIComponent(process.cwd())}`,
		);

		publish({
			type: 'message.created',
			sessionId: 'proj-events-session-1',
			projectRoot: process.cwd(),
			payload: { id: 'msg-1', role: 'assistant' },
		});

		const received = await stream.next(
			(evt) => evt.event === 'message.created',
		);
		expect(received.data.sessionId).toBe('proj-events-session-1');
		expect((received.data.payload as Record<string, unknown>).id).toBe('msg-1');

		await stream.close();
	});

	it('filters out events from other projects', async () => {
		const stream = await openStream(
			`/v1/events/project?project=${encodeURIComponent(process.cwd())}`,
		);

		publish({
			type: 'message.created',
			sessionId: 'other-project-session',
			projectRoot: '/tmp/otto-some-other-project',
			payload: { id: 'msg-other' },
		});
		publish({
			type: 'message.created',
			sessionId: 'proj-events-session-2',
			projectRoot: process.cwd(),
			payload: { id: 'msg-mine' },
		});

		const received = await stream.next(
			(evt) => evt.event === 'message.created',
		);
		expect(received.data.sessionId).toBe('proj-events-session-2');

		await stream.close();
	});

	it('carries client events on the same connection', async () => {
		const stream = await openStream(
			`/v1/events/project?project=${encodeURIComponent(process.cwd())}`,
		);

		publishClientEvent({
			type: 'notification',
			payload: {
				id: 'n-1',
				title: 'test',
				level: 'info',
				createdAt: new Date().toISOString(),
			},
		});

		const received = await stream.next((evt) => evt.event === 'notification');
		expect(received.data.sessionId).toBeUndefined();
		expect((received.data.payload as Record<string, unknown>).id).toBe('n-1');

		await stream.close();
	});

	it('filters client events from other projects', async () => {
		const stream = await openStream(
			`/v1/events/project?project=${encodeURIComponent(process.cwd())}`,
		);
		const createdAt = new Date().toISOString();

		publishClientEvent({
			type: 'notification',
			payload: {
				id: 'notification-other-project',
				title: 'other project',
				level: 'info',
				projectRoot: '/tmp/otto-some-other-project',
				createdAt,
			},
		});
		publishClientEvent({
			type: 'notification',
			payload: {
				id: 'notification-current-project',
				title: 'current project',
				level: 'info',
				projectRoot: process.cwd(),
				createdAt,
			},
		});

		const notification = await stream.next(
			(evt) => evt.event === 'notification',
		);
		expect((notification.data.payload as Record<string, unknown>).id).toBe(
			'notification-current-project',
		);

		publishClientEvent({
			type: 'session.status',
			payload: {
				sessionId: 'status-other-project',
				projectRoot: '/tmp/otto-some-other-project',
				status: 'completed',
				createdAt,
			},
		});
		publishClientEvent({
			type: 'session.status',
			payload: {
				sessionId: 'status-current-project',
				projectRoot: process.cwd(),
				status: 'completed',
				createdAt,
			},
		});

		const status = await stream.next((evt) => evt.event === 'session.status');
		expect((status.data.payload as Record<string, unknown>).sessionId).toBe(
			'status-current-project',
		);

		await stream.close();
	});

	it('serves the POST alias for tunnels', async () => {
		const stream = await openStream(
			`/v1/events/project?project=${encodeURIComponent(process.cwd())}`,
			'POST',
		);
		expect(stream.headers.get('cache-control')).toBe('no-cache, no-transform');
		expect(stream.headers.get('x-accel-buffering')).toBe('no');

		publish({
			type: 'message.created',
			sessionId: 'proj-events-session-post',
			projectRoot: process.cwd(),
			payload: { id: 'msg-post' },
		});

		const received = await stream.next(
			(evt) => evt.event === 'message.created',
		);
		expect(received.data.sessionId).toBe('proj-events-session-post');

		await stream.close();
	});

	it('delivers events published with only a projectId', async () => {
		const stream = await openStream(
			`/v1/events/project?project=${encodeURIComponent(process.cwd())}`,
		);

		publish({
			type: 'queue.updated',
			sessionId: 'proj-events-session-id-only',
			projectId: 'some-project-id-not-root',
			payload: { queueLength: 0 },
		});

		const received = await stream.next((evt) => evt.event === 'queue.updated');
		expect(received.data.sessionId).toBe('proj-events-session-id-only');

		await stream.close();
	});

	it('does not double-deliver when a subscriber matches multiple keys', async () => {
		const stream = await openStream(
			`/v1/events/project?project=${encodeURIComponent(process.cwd())}`,
		);

		publish({
			type: 'message.created',
			sessionId: 'proj-events-session-dedupe',
			projectRoot: process.cwd(),
			payload: { id: 'msg-dedupe' },
		});
		publish({
			type: 'message.completed',
			sessionId: 'proj-events-session-dedupe',
			projectRoot: process.cwd(),
			payload: { id: 'msg-dedupe' },
		});

		let createdCount = 0;
		await stream.next((evt) => {
			if (evt.event === 'message.created') createdCount += 1;
			return evt.event === 'message.completed';
		});
		expect(createdCount).toBe(1);

		await stream.close();
	});
});
