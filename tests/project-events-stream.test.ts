import { afterAll, describe, expect, it } from 'bun:test';
import { createApp } from '@ottocode/server';
import {
	publish,
	publishClientEvent,
} from '../packages/server/src/events/bus.ts';

const app = createApp();
const server = Bun.serve({ port: 0, fetch: app.fetch });

afterAll(() => {
	server.stop(true);
});

interface ParsedEvent {
	event: string;
	data: Record<string, unknown>;
}

async function openStream(url: string) {
	const response = await fetch(url);
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

	return { next, close: () => reader.cancel() };
}

describe('multiplexed project events stream', () => {
	it('carries session events with a sessionId envelope', async () => {
		const stream = await openStream(
			`http://127.0.0.1:${server.port}/v1/events/project?project=${encodeURIComponent(process.cwd())}`,
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
			`http://127.0.0.1:${server.port}/v1/events/project?project=${encodeURIComponent(process.cwd())}`,
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
			`http://127.0.0.1:${server.port}/v1/events/project?project=${encodeURIComponent(process.cwd())}`,
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
});
