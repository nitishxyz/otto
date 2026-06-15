import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import {
	getDictationSessionPcmPath,
	getDictationSessionWavPath,
	getDictationTempDir,
} from './paths.ts';
import { isSupportedAudioFormat, normalizeAudioFormat } from './protocol.ts';
import {
	DEFAULT_AUDIO_FORMAT,
	DEFAULT_DICTATION_MODEL,
	type AudioFormat,
	type DictationErrorCode,
	type DictationServerEvent,
	type DictationSession,
} from './types.ts';
import {
	DictationTranscriptionError,
	createWhisperCppTranscriptionRunner,
	type DictationTranscriptionRunner,
} from './transcribe.ts';

const MAX_DICTATION_BYTES = 32 * 1024 * 1024;
const SPEECH_FRAME_MS = 20;
const MIN_SPEECH_FRAME_COUNT = 3;
const SPEECH_RMS_THRESHOLD = 0.01;
const SPEECH_PEAK_THRESHOLD = 0.03;
const IGNORED_TRANSCRIPTS = new Set(['speaking in foreign language']);

export class DictationSessionError extends Error {
	constructor(
		readonly code: DictationErrorCode,
		message: string,
	) {
		super(message);
		this.name = 'DictationSessionError';
	}
}

export type CreateDictationSessionInput = {
	model?: string;
	language?: string;
	format?: Partial<AudioFormat>;
};

export type StartDictationSessionInput = CreateDictationSessionInput;

export class DictationSessionManager {
	private readonly sessions = new Map<string, DictationSession>();
	private readonly appendQueues = new Map<string, Promise<DictationSession>>();

	constructor(
		private readonly transcriptionRunner: DictationTranscriptionRunner = createWhisperCppTranscriptionRunner(),
	) {}

	create(input: CreateDictationSessionInput = {}): DictationSession {
		const id = `dict_${randomUUID()}`;
		const now = new Date().toISOString();
		const format = normalizeAudioFormat(input.format ?? DEFAULT_AUDIO_FORMAT);
		const session: DictationSession = {
			id,
			status: 'created',
			model: input.model || DEFAULT_DICTATION_MODEL,
			language: input.language || 'en',
			format,
			createdAt: now,
			updatedAt: now,
			receivedBytes: 0,
			receivedMs: 0,
			pcmPath: getDictationSessionPcmPath(id),
			wavPath: getDictationSessionWavPath(id),
		};
		this.sessions.set(id, session);
		return { ...session };
	}

	get(id: string): DictationSession | undefined {
		const session = this.sessions.get(id);
		return session ? { ...session } : undefined;
	}

	list(): DictationSession[] {
		return Array.from(this.sessions.values()).map((session) => ({
			...session,
		}));
	}

	async delete(id: string): Promise<boolean> {
		const session = this.sessions.get(id);
		if (!session) return false;
		await this.appendQueues.get(id)?.catch(() => undefined);
		this.appendQueues.delete(id);
		this.sessions.delete(id);
		await cleanupSessionFiles(session);
		return true;
	}

	async start(
		id: string,
		input: StartDictationSessionInput = {},
	): Promise<DictationSession> {
		const session = this.requireSession(id);
		if (session.status !== 'created') {
			throw new DictationSessionError(
				'DICTATION_INVALID_STATE',
				`Cannot start dictation session from ${session.status}`,
			);
		}

		const format = normalizeAudioFormat(input.format ?? session.format);
		if (!isSupportedAudioFormat(format)) {
			throw new DictationSessionError(
				'DICTATION_AUDIO_FORMAT_UNSUPPORTED',
				'Only pcm_s16le, 16 kHz, mono audio is supported',
			);
		}

		await mkdir(getDictationTempDir(), { recursive: true });
		await writeFile(session.pcmPath, Buffer.alloc(0));
		await writeFile(session.wavPath, Buffer.alloc(0));
		this.appendQueues.delete(id);

		session.status = 'recording';
		session.model = input.model || session.model;
		session.language = input.language || session.language;
		session.format = format;
		touch(session);
		this.transcriptionRunner
			.prepare?.({ session: { ...session } })
			.catch(() => undefined);
		return { ...session };
	}

	async appendAudioFrame(
		id: string,
		frame: Uint8Array,
	): Promise<DictationSession> {
		const previousAppend = this.appendQueues.get(id);
		const append =
			previousAppend
				?.catch(() => undefined)
				.then(() => this.appendAudioFrameNow(id, frame)) ??
			this.appendAudioFrameNow(id, frame);
		this.appendQueues.set(id, append);
		try {
			return await append;
		} finally {
			if (this.appendQueues.get(id) === append) {
				this.appendQueues.delete(id);
			}
		}
	}

	async stop(id: string): Promise<DictationServerEvent> {
		await this.appendQueues.get(id)?.catch((error) => {
			throw error;
		});
		const session = this.requireSession(id);
		if (session.status !== 'recording') {
			throw new DictationSessionError(
				'DICTATION_INVALID_STATE',
				`Cannot stop dictation session from ${session.status}`,
			);
		}

		session.status = 'transcribing';
		touch(session);

		try {
			const pcm = await readFile(session.pcmPath);
			await writeFile(session.wavPath, createWavFile(pcm, session.format));
			const { text } = shouldTranscribePcm(pcm, session.format)
				? await this.transcriptionRunner.transcribe({
						session: { ...session },
						wavPath: session.wavPath,
					})
				: { text: '' };
			const finalText = sanitizeTranscript(text);
			session.status = 'completed';
			session.text = finalText;
			touch(session);
			return {
				type: 'final',
				text: finalText,
				language: session.language,
				model: session.model,
				durationMs: session.receivedMs,
			};
		} catch (error) {
			session.status = 'error';
			session.error = error instanceof Error ? error.message : String(error);
			touch(session);
			if (error instanceof DictationTranscriptionError) {
				throw new DictationSessionError(error.code, error.message);
			}
			throw new DictationSessionError(
				'DICTATION_TRANSCRIBE_FAILED',
				session.error,
			);
		}
	}

	async cancel(id: string): Promise<boolean> {
		const session = this.sessions.get(id);
		if (!session) return false;
		await this.appendQueues.get(id)?.catch(() => undefined);
		this.appendQueues.delete(id);
		session.status = 'cancelled';
		touch(session);
		await cleanupSessionFiles(session);
		return true;
	}

	private async appendAudioFrameNow(
		id: string,
		frame: Uint8Array,
	): Promise<DictationSession> {
		const session = this.requireSession(id);
		if (session.status !== 'recording') {
			throw new DictationSessionError(
				'DICTATION_INVALID_STATE',
				'Audio frames can only be appended while recording',
			);
		}
		if (session.receivedBytes + frame.byteLength > MAX_DICTATION_BYTES) {
			session.status = 'error';
			session.error = 'Audio stream exceeded maximum size';
			touch(session);
			throw new DictationSessionError(
				'DICTATION_AUDIO_TOO_LARGE',
				'Audio stream exceeded maximum size',
			);
		}

		await appendFile(session.pcmPath, frame);
		session.receivedBytes += frame.byteLength;
		session.receivedMs = calculateDurationMs(
			session.receivedBytes,
			session.format,
		);
		touch(session);
		return { ...session };
	}

	private requireSession(id: string): DictationSession {
		const session = this.sessions.get(id);
		if (!session) {
			throw new DictationSessionError(
				'DICTATION_SESSION_NOT_FOUND',
				'Dictation session not found',
			);
		}
		return session;
	}
}

export function createDictationSessionManager(
	transcriptionRunner?: DictationTranscriptionRunner,
): DictationSessionManager {
	return new DictationSessionManager(transcriptionRunner);
}

function touch(session: DictationSession) {
	session.updatedAt = new Date().toISOString();
}

function calculateDurationMs(bytes: number, format: AudioFormat): number {
	const bytesPerSample = format.encoding === 'pcm_s16le' ? 2 : 1;
	const bytesPerSecond = format.sampleRate * format.channels * bytesPerSample;
	return Math.floor((bytes / bytesPerSecond) * 1000);
}

function shouldTranscribePcm(pcm: Buffer, format: AudioFormat): boolean {
	const samplesPerFrame = Math.max(
		1,
		Math.floor((format.sampleRate * SPEECH_FRAME_MS) / 1000) * format.channels,
	);
	const bytesPerFrame = samplesPerFrame * 2;
	let speechFrames = 0;

	for (let offset = 0; offset + 1 < pcm.byteLength; offset += bytesPerFrame) {
		const energy = calculatePcmFrameEnergy(
			pcm,
			offset,
			Math.min(offset + bytesPerFrame, pcm.byteLength),
		);
		if (
			energy.rms >= SPEECH_RMS_THRESHOLD ||
			energy.peak >= SPEECH_PEAK_THRESHOLD
		) {
			speechFrames++;
			if (speechFrames >= MIN_SPEECH_FRAME_COUNT) return true;
		}
	}

	return false;
}

function sanitizeTranscript(text: string): string {
	const trimmed = text.trim();
	if (IGNORED_TRANSCRIPTS.has(normalizeTranscriptForFiltering(trimmed))) {
		return '';
	}
	return trimmed;
}

function normalizeTranscriptForFiltering(text: string): string {
	return text
		.toLowerCase()
		.replace(/^[\s([{"'“‘]+|[\s)\]}"'”’.,!?]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function calculatePcmFrameEnergy(
	pcm: Buffer,
	start: number,
	end: number,
): { rms: number; peak: number } {
	let sumSquares = 0;
	let peak = 0;
	let samples = 0;
	for (let index = start; index + 1 < end; index += 2) {
		const sample = pcm.readInt16LE(index) / 32768;
		const abs = Math.abs(sample);
		peak = Math.max(peak, abs);
		sumSquares += sample * sample;
		samples++;
	}

	return {
		rms: samples === 0 ? 0 : Math.sqrt(sumSquares / samples),
		peak,
	};
}

function createWavFile(pcm: Buffer, format: AudioFormat): Buffer {
	const header = Buffer.alloc(44);
	const bytesPerSample = 2;
	const byteRate = format.sampleRate * format.channels * bytesPerSample;
	const blockAlign = format.channels * bytesPerSample;

	header.write('RIFF', 0);
	header.writeUInt32LE(36 + pcm.byteLength, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(format.channels, 22);
	header.writeUInt32LE(format.sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(pcm.byteLength, 40);

	return Buffer.concat([header, pcm]);
}

async function cleanupSessionFiles(session: DictationSession): Promise<void> {
	await Promise.all([
		rm(session.pcmPath, { force: true }),
		rm(session.wavPath, { force: true }),
	]);
}
