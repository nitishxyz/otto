import { describe, expect, test } from 'bun:test';
import { createApp } from '@ottocode/server';
import { publish } from '../packages/server/src/events/bus.ts';
import { ensureDaemonToken } from '../packages/server/src/tunnel-auth.ts';

const app = createApp();

interface ParsedEvent {
	id?: string;
	event: string;
	data: Record<string, unknown>;
}

async function openDesktopStream(lastEventId?: string) {
	const token = await ensureDaemonToken();
	const abort = new AbortController();
	const response = await app.fetch(
		new Request('http://localhost/v1/events/desktop', {
			headers: {
				'X-Otto-Server-Token': token,
				...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
			},
			signal: abort.signal,
		}),
	);
	expect(response.ok).toBe(true);
	const reader = response.body?.getReader();
	if (!reader) throw new Error('No desktop stream body');
	const decoder = new TextDecoder();
	let buffer = '';

	return {
		next: async (match: (event: ParsedEvent) => boolean) => {
			const deadline = Date.now() + 3_000;
			while (Date.now() < deadline) {
				let index = buffer.indexOf('\n\n');
				while (index !== -1) {
					const raw = buffer.slice(0, index);
					buffer = buffer.slice(index + 2);
					let id: string | undefined;
					let event = 'message';
					let data = '';
					for (const line of raw.split('\n')) {
						if (line.startsWith('id:')) id = line.slice(3).trim();
						else if (line.startsWith('event: ')) {
							event = line.slice(7).trim();
						} else if (line.startsWith('data: ')) {
							data += line.slice(6);
						}
					}
					if (data) {
						const parsed = { id, event, data: JSON.parse(data) };
						if (match(parsed)) return parsed;
					}
					index = buffer.indexOf('\n\n');
				}
				const chunk = await Promise.race([
					reader.read(),
					Bun.sleep(Math.max(0, deadline - Date.now())).then(() => null),
				]);
				if (!chunk || chunk.done) break;
				buffer += decoder.decode(chunk.value, { stream: true });
			}
			throw new Error('Timed out waiting for desktop event');
		},
		close: async () => {
			abort.abort();
			await reader.cancel().catch(() => {});
		},
	};
}

describe('desktop event stream', () => {
	test('requires the daemon token', async () => {
		const response = await app.request('/v1/events/desktop');
		expect(response.status).toBe(401);
	});

	test('multiplexes projects with routing metadata and replay', async () => {
		const first = await openDesktopStream();
		publish({
			type: 'message.created',
			sessionId: 'desktop-project-a-session',
			projectId: 'desktop-project-a',
			projectRoot: '/tmp/desktop-project-a',
			payload: { id: 'desktop-message-a' },
		});
		publish({
			type: 'message.created',
			sessionId: 'desktop-project-b-session',
			projectId: 'desktop-project-b',
			projectRoot: '/tmp/desktop-project-b',
			payload: { id: 'desktop-message-b' },
		});

		const projectA = await first.next(
			(event) =>
				(event.data.payload as { id?: string }).id === 'desktop-message-a',
		);
		expect(projectA.data.projectId).toBe('desktop-project-a');
		expect(projectA.data.projectRoot).toBe('/tmp/desktop-project-a');
		const projectB = await first.next(
			(event) =>
				(event.data.payload as { id?: string }).id === 'desktop-message-b',
		);
		expect(projectB.data.projectId).toBe('desktop-project-b');
		expect(projectB.id).toBeTruthy();
		await first.close();

		publish({
			type: 'message.completed',
			sessionId: 'desktop-project-a-session',
			projectId: 'desktop-project-a',
			projectRoot: '/tmp/desktop-project-a',
			payload: { id: 'desktop-message-replayed' },
		});
		const replay = await openDesktopStream(projectB.id);
		const replayed = await replay.next(
			(event) =>
				(event.data.payload as { id?: string }).id ===
				'desktop-message-replayed',
		);
		expect(replayed.event).toBe('message.completed');
		expect(Number(replayed.id)).toBeGreaterThan(Number(projectB.id));
		await replay.close();
	});
});
