import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import {
	getGlobalConfigDir,
	loadConfig,
	loadGlobalConfig,
} from '@ottocode/sdk';
import { formatDictationTranscript } from './format.ts';
import { getDictationModelPath, getDictationTempDir } from './paths.ts';
import {
	applyDictationKeywordAliases,
	mergeDictationKeywords,
	resolveDictationPrompt,
} from './prompt.ts';
import type { DictationErrorCode, DictationSession } from './types.ts';

export type DictationTranscriptionInput = {
	session: DictationSession;
	wavPath: string;
};

export type DictationPrepareInput = {
	session: DictationSession;
};

export type DictationTranscriptionResult = {
	text: string;
};

export interface DictationTranscriptionRunner {
	prepare?(input: DictationPrepareInput): Promise<void>;
	transcribe(
		input: DictationTranscriptionInput,
	): Promise<DictationTranscriptionResult>;
}

export class DictationTranscriptionError extends Error {
	constructor(
		readonly code: DictationErrorCode,
		message: string,
	) {
		super(message);
		this.name = 'DictationTranscriptionError';
	}
}

const WHISPER_BINARY_NAMES =
	process.platform === 'win32'
		? ['whisper-cli.exe', 'whisper.exe']
		: ['whisper-cli', 'whisper'];

const WARMUP_TTL_MS = 10 * 60 * 1000;
const warmupByModel = new Map<
	string,
	{ promise: Promise<void> | null; warmedAt: number }
>();

export function createWhisperCppTranscriptionRunner(): DictationTranscriptionRunner {
	return {
		async prepare(input) {
			await warmWhisperModel(input.session);
		},

		async transcribe(input) {
			await waitForWarmup(input.session.model);
			const { binaryPath, modelPath } = await resolveWhisperRuntime(
				input.session.model,
			);
			const config = input.session.projectRoot
				? await loadConfig(input.session.projectRoot)
				: await loadGlobalConfig();
			const keywords = mergeDictationKeywords(
				config.defaults.dictationKeywords,
			);
			const prompt = await resolveDictationPrompt({
				prompt: input.session.prompt,
				projectRoot: input.session.projectRoot,
				keywords,
				excludedProjectKeywords:
					config.defaults.dictationExcludedProjectKeywords,
			});

			const { stdout } = await runWhisperCli([
				binaryPath,
				'-m',
				modelPath,
				'-f',
				input.wavPath,
				'-l',
				input.session.language || 'en',
				'-nt',
				'-np',
				...(prompt ? ['--prompt', prompt] : []),
			]);

			const corrected = applyDictationKeywordAliases(
				extractTranscript(stdout),
				keywords,
			);
			return {
				text: config.defaults.dictationSmartFormatting
					? formatDictationTranscript(corrected)
					: corrected,
			};
		},
	};
}

async function warmWhisperModel(session: DictationSession): Promise<void> {
	const existing = warmupByModel.get(session.model);
	if (existing?.promise) return existing.promise;
	if (existing && Date.now() - existing.warmedAt < WARMUP_TTL_MS) return;

	const promise = runWarmup(session)
		.then(() => {
			warmupByModel.set(session.model, {
				promise: null,
				warmedAt: Date.now(),
			});
		})
		.catch((error) => {
			warmupByModel.delete(session.model);
			throw error;
		});
	warmupByModel.set(session.model, { promise, warmedAt: 0 });
	return promise;
}

async function waitForWarmup(model: string): Promise<void> {
	const warmup = warmupByModel.get(model)?.promise;
	if (warmup) await warmup.catch(() => undefined);
}

async function runWarmup(session: DictationSession): Promise<void> {
	const { binaryPath, modelPath } = await resolveWhisperRuntime(session.model);
	await mkdir(getDictationTempDir(), { recursive: true });
	const warmupPath = join(getDictationTempDir(), `${session.model}.warmup.wav`);
	await writeFile(warmupPath, createSilentWav());
	try {
		await runWhisperCli([
			binaryPath,
			'-m',
			modelPath,
			'-f',
			warmupPath,
			'-l',
			session.language || 'en',
			'-nt',
			'-np',
		]);
	} finally {
		await rm(warmupPath, { force: true });
	}
}

async function resolveWhisperRuntime(
	model: string,
): Promise<{ binaryPath: string; modelPath: string }> {
	const binaryPath = await resolveWhisperBinary();
	if (!binaryPath) {
		throw new DictationTranscriptionError(
			'DICTATION_ENGINE_MISSING',
			'whisper.cpp runtime is not installed yet',
		);
	}

	const modelPath = getDictationModelPath(model);
	if (!(await fileExists(modelPath))) {
		throw new DictationTranscriptionError(
			'DICTATION_MODEL_MISSING',
			'Install a local dictation model before recording',
		);
	}

	return { binaryPath, modelPath };
}

async function runWhisperCli(
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	const proc = Bun.spawn(args, {
		stdout: 'pipe',
		stderr: 'pipe',
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (exitCode !== 0) {
		throw new DictationTranscriptionError(
			'DICTATION_TRANSCRIBE_FAILED',
			stderr.trim() || stdout.trim() || `whisper.cpp exited with ${exitCode}`,
		);
	}

	return { stdout, stderr };
}

async function resolveWhisperBinary(): Promise<string | null> {
	const configured = process.env.OTTO_WHISPER_CLI?.trim();
	if (configured && (await fileExists(configured))) return configured;

	for (const name of WHISPER_BINARY_NAMES) {
		const localPath = join(getGlobalConfigDir(), 'bin', name);
		if (await fileExists(localPath)) return localPath;
	}

	for (const dir of (process.env.PATH || '').split(delimiter)) {
		if (!dir) continue;
		for (const name of WHISPER_BINARY_NAMES) {
			const candidate = join(dir, name);
			if (await fileExists(candidate)) return candidate;
		}
	}

	return null;
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function extractTranscript(output: string): string {
	const lines = output
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !line.startsWith('whisper_'))
		.filter((line) => !line.startsWith('main:'))
		.filter((line) => !line.startsWith('system_info:'))
		.map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
		.filter(Boolean);
	return lines.join(' ').trim();
}

function createSilentWav(): Buffer {
	const sampleRate = 16_000;
	const channels = 1;
	const bytesPerSample = 2;
	const pcm = Buffer.alloc(sampleRate * channels * bytesPerSample * 0.1);
	const header = Buffer.alloc(44);
	const byteRate = sampleRate * channels * bytesPerSample;
	const blockAlign = channels * bytesPerSample;

	header.write('RIFF', 0);
	header.writeUInt32LE(36 + pcm.byteLength, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(pcm.byteLength, 40);

	return Buffer.concat([header, pcm]);
}
