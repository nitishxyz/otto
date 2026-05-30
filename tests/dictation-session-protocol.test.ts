import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '@ottocode/server';
import { getDictationModelPath } from '../packages/server/src/dictation/paths.ts';
import {
	DictationSessionError,
	createDictationSessionManager,
} from '../packages/server/src/dictation/sessions.ts';
import type { DictationTranscriptionRunner } from '../packages/server/src/dictation/transcribe.ts';

const tempConfigHome = join(tmpdir(), 'otto-dictation-tests');
let originalXdgConfigHome: string | undefined;

const fakeTranscriptionRunner: DictationTranscriptionRunner = {
	async transcribe({ session }) {
		return {
			text:
				session.receivedBytes === 0
					? ''
					: `[dictation fake: received ${session.receivedMs}ms of audio]`,
		};
	},
};

function createAudiblePcm(durationMs: number): Uint8Array {
	const sampleRate = 16_000;
	const samples = Math.floor((sampleRate * durationMs) / 1000);
	const frame = new Uint8Array(samples * 2);
	const view = new DataView(frame.buffer);
	for (let index = 0; index < samples; index++) {
		const sample = Math.round(
			Math.sin((index / sampleRate) * 2 * Math.PI * 440) * 8000,
		);
		view.setInt16(index * 2, sample, true);
	}
	return frame;
}

beforeEach(async () => {
	originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
	process.env.XDG_CONFIG_HOME = tempConfigHome;
	await rm(tempConfigHome, { recursive: true, force: true });
	await mkdir(tempConfigHome, { recursive: true });
});

afterEach(async () => {
	if (originalXdgConfigHome === undefined) {
		delete process.env.XDG_CONFIG_HOME;
	} else {
		process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
	}
	await rm(tempConfigHome, { recursive: true, force: true });
});

describe('dictation session manager', () => {
	test('buffers streamed PCM frames and creates a WAV on stop', async () => {
		const manager = createDictationSessionManager(fakeTranscriptionRunner);
		const created = manager.create();
		const started = await manager.start(created.id);

		expect(started.status).toBe('recording');

		const frame = createAudiblePcm(300);
		const updated = await manager.appendAudioFrame(created.id, frame);

		expect(updated.receivedBytes).toBe(9600);
		expect(updated.receivedMs).toBe(300);

		const final = await manager.stop(created.id);

		expect(final.type).toBe('final');
		expect(final.durationMs).toBe(300);
		expect(final.text).toBe('[dictation fake: received 300ms of audio]');

		const wav = await readFile(created.wavPath);
		expect(wav.subarray(0, 4).toString()).toBe('RIFF');
		expect(wav.subarray(8, 12).toString()).toBe('WAVE');
		expect(wav.byteLength).toBe(44 + frame.byteLength);
	});

	test('returns an empty transcript for silent audio without transcribing', async () => {
		let transcribeCalls = 0;
		const manager = createDictationSessionManager({
			async transcribe() {
				transcribeCalls++;
				return { text: 'you' };
			},
		});
		const created = manager.create();
		await manager.start(created.id);

		await manager.appendAudioFrame(created.id, new Uint8Array(16_000));
		const final = await manager.stop(created.id);

		expect(final.type).toBe('final');
		expect(final.text).toBe('');
		expect(transcribeCalls).toBe(0);
	});

	test('filters foreign-language placeholder transcripts', async () => {
		const manager = createDictationSessionManager({
			async transcribe() {
				return { text: '(speaking in foreign language)' };
			},
		});
		const created = manager.create();
		await manager.start(created.id);

		await manager.appendAudioFrame(created.id, createAudiblePcm(300));
		const final = await manager.stop(created.id);

		expect(final.type).toBe('final');
		expect(final.text).toBe('');
	});

	test('rejects audio frames before start', async () => {
		const manager = createDictationSessionManager();
		const created = manager.create();

		await expect(
			manager.appendAudioFrame(created.id, new Uint8Array(2)),
		).rejects.toThrow(DictationSessionError);
	});

	test('rejects unsupported audio formats', async () => {
		const manager = createDictationSessionManager();
		const created = manager.create();

		await expect(
			manager.start(created.id, {
				format: {
					encoding: 'pcm_s16le',
					sampleRate: 48000,
					channels: 1,
				},
			}),
		).rejects.toThrow(DictationSessionError);
	});
});

describe('dictation routes', () => {
	test('returns dictation status', async () => {
		const app = createApp();
		const response = await app.fetch(
			new Request('http://localhost/v1/dictation/status'),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.engine).toBe('whisper.cpp');
		expect(body.defaultModel).toBe('small.en-q5_1');
		expect(Array.isArray(body.models)).toBe(true);
		expect(
			body.models.some((model: { installed: boolean }) => model.installed),
		).toBe(false);
	});

	test('reports installed models and removes them', async () => {
		const app = createApp();
		await mkdir(join(tempConfigHome, 'otto', 'dictation', 'models'), {
			recursive: true,
		});
		await writeFile(getDictationModelPath('small.en-q5_1'), 'model-bytes');

		const listResponse = await app.fetch(
			new Request('http://localhost/v1/dictation/models'),
		);
		const listBody = await listResponse.json();
		const smallModel = listBody.models.find(
			(model: { id: string }) => model.id === 'small.en-q5_1',
		);

		expect(listResponse.status).toBe(200);
		expect(smallModel.installed).toBe(true);
		expect(smallModel.installedSizeBytes).toBe('model-bytes'.length);

		const removeResponse = await app.fetch(
			new Request('http://localhost/v1/dictation/models/small.en-q5_1', {
				method: 'DELETE',
			}),
		);
		const removeBody = await removeResponse.json();

		expect(removeResponse.status).toBe(200);
		expect(removeBody.removed).toBe(true);
		expect(removeBody.model.installed).toBe(false);
	});

	test('returns installed model without downloading when present', async () => {
		const app = createApp();
		await mkdir(join(tempConfigHome, 'otto', 'dictation', 'models'), {
			recursive: true,
		});
		await writeFile(getDictationModelPath('small.en-q5_1'), 'model-bytes');

		const response = await app.fetch(
			new Request(
				'http://localhost/v1/dictation/models/small.en-q5_1/install',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				},
			),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.model.id).toBe('small.en-q5_1');
		expect(body.model.installed).toBe(true);
		expect(body.model.installStatus).toBe('installed');
	});

	test('streams model install state events', async () => {
		const app = createApp();
		await mkdir(join(tempConfigHome, 'otto', 'dictation', 'models'), {
			recursive: true,
		});
		await writeFile(getDictationModelPath('small.en-q5_1'), 'model-bytes');

		const response = await app.fetch(
			new Request(
				'http://localhost/v1/dictation/models/small.en-q5_1/install/events',
			),
		);
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/event-stream');
		expect(body).toContain('"installStatus":"installed"');
	});

	test('returns a clear error for unknown model install', async () => {
		const app = createApp();
		const response = await app.fetch(
			new Request('http://localhost/v1/dictation/models/missing/install', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			}),
		);
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body.code).toBe('DICTATION_MODEL_NOT_FOUND');
	});

	test('creates a streaming dictation session', async () => {
		const app = createApp();
		const response = await app.fetch(
			new Request('http://localhost/v1/dictation/sessions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ language: 'en' }),
			}),
		);
		const body = await response.json();

		expect(response.status).toBe(201);
		expect(body.id.startsWith('dict_')).toBe(true);
		expect(body.wsUrl).toContain(`/v1/dictation/sessions/${body.id}/ws`);
		expect(body.format.encoding).toBe('pcm_s16le');
	});
});
