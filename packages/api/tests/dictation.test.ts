import { describe, expect, test } from 'bun:test';
import {
	connectDictationSession,
	parseDictationServerEvent,
	resolveDictationWebSocketUrl,
	streamDictationModelInstall,
	type DictationWebSocketLike,
} from '../src/dictation.ts';

class MockWebSocket implements DictationWebSocketLike {
	readyState = 1;
	binaryType: BinaryType = 'blob';
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	sent: Array<string | ArrayBufferLike | ArrayBufferView> = [];

	send(data: string | ArrayBufferLike | ArrayBufferView) {
		this.sent.push(data);
	}

	close() {
		this.readyState = 3;
	}

	emitOpen() {
		this.onopen?.(new Event('open'));
	}

	emitMessage(value: unknown) {
		this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
	}
}

describe('dictation transport', () => {
	test('resolves a socket through an overridden API origin', () => {
		expect(
			resolveDictationWebSocketUrl(
				'ws://127.0.0.1:9100/v1/dictation/sessions/dict_1/ws?ticket=abc',
				'https://otto.example.com/api',
			),
		).toBe('wss://otto.example.com/v1/dictation/sessions/dict_1/ws?ticket=abc');
	});

	test('streams audio and resolves the final transcript', async () => {
		const socket = new MockWebSocket();
		const connected = connectDictationSession({
			session: {
				id: 'dict_1',
				wsUrl: 'ws://127.0.0.1:9100/v1/dictation/sessions/dict_1/ws',
				model: 'small.en-q5_1',
				modelInstalled: true,
				format: { encoding: 'pcm_s16le', sampleRate: 16_000, channels: 1 },
			},
			webSocketFactory: () => socket,
		});

		socket.emitOpen();
		expect(JSON.parse(socket.sent[0] as string)).toMatchObject({
			type: 'start',
			model: 'small.en-q5_1',
		});
		socket.emitMessage({
			type: 'ready',
			sessionId: 'dict_1',
			model: 'small.en-q5_1',
			format: { encoding: 'pcm_s16le', sampleRate: 16_000, channels: 1 },
		});
		const connection = await connected;
		connection.sendAudio(new Uint8Array([1, 2, 3, 4]));
		expect(socket.sent.at(-1)).toBeInstanceOf(Uint8Array);

		const finalPromise = connection.stop();
		expect(JSON.parse(socket.sent.at(-1) as string)).toEqual({ type: 'stop' });
		socket.emitMessage({
			type: 'final',
			text: 'hello from dictation',
			language: 'en',
			model: 'small.en-q5_1',
			durationMs: 800,
		});
		expect(await finalPromise).toMatchObject({
			type: 'final',
			text: 'hello from dictation',
		});
	});

	test('parses model install SSE events', async () => {
		const models: string[] = [];
		await streamDictationModelInstall({
			baseUrl: 'http://127.0.0.1:9100',
			model: 'small.en-q5_1',
			fetch: async () =>
				new Response(
					`data: ${JSON.stringify({
						type: 'model',
						model: {
							id: 'small.en-q5_1',
							label: 'Small English',
							language: 'en',
							sizeBytes: 100,
							url: 'https://example.com/model',
							sha256: 'abc',
							installed: true,
							installing: false,
							installedSizeBytes: 100,
							installStatus: 'installed',
							progressBytes: 100,
							totalBytes: 100,
						},
					})}\n\n`,
					{ headers: { 'Content-Type': 'text/event-stream' } },
				),
			onModel: (model) => models.push(model.id),
		});
		expect(models).toEqual(['small.en-q5_1']);
	});

	test('rejects malformed server events', () => {
		expect(parseDictationServerEvent('{bad json')).toBeNull();
		expect(parseDictationServerEvent('{"type":"unknown"}')).toBeNull();
	});
});
