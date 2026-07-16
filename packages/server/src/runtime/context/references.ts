import {
	isSupportedGitReferenceUrl,
	type OttoConfig,
	type ReferenceConfig,
} from '@ottocode/sdk';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { publishClientEvent } from '../../events/bus.ts';

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GIT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_GIT_OUTPUT_LINES = 80;
const preparations = new Map<
	string,
	{ promise: Promise<void>; abortController: AbortController }
>();
const preparationStates = new Map<string, ReferencePreparationStatus>();

export type ResolvedReference = {
	name: string;
	description: string;
	path?: string;
	status: 'available' | 'unavailable';
	error?: string;
};

export type ReferencePreparationStatus = {
	status: 'cloning' | 'available' | 'error';
	error?: string;
	output?: string[];
};

/** Resolve enabled references from local state without performing network I/O. */
export async function resolveReferences(
	cfg: OttoConfig,
): Promise<ResolvedReference[]> {
	const entries = Object.entries(cfg.references ?? {}).filter(
		([, reference]) => reference.enabled !== false,
	);
	const resolved = await Promise.all(
		entries.map(([name, reference]) => resolveReference(name, reference, cfg)),
	);
	return resolved.filter((reference) => reference.status === 'available');
}

async function resolveReference(
	name: string,
	reference: ReferenceConfig,
	cfg: OttoConfig,
): Promise<ResolvedReference> {
	try {
		if (!reference.description.trim()) {
			throw new Error('Description is required');
		}
		const path =
			reference.source.type === 'local'
				? await resolveLocalReference(reference.source.path, cfg.projectRoot)
				: await resolveCachedGitReference(name, reference, cfg.paths.cacheDir);
		return {
			name,
			description: reference.description.trim(),
			path,
			status: 'available',
		};
	} catch (error) {
		return {
			name,
			description: reference.description.trim(),
			status: 'unavailable',
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Start preparing enabled Git references without blocking the caller. */
export function prepareReferences(cfg: OttoConfig): void {
	for (const [name, reference] of Object.entries(cfg.references ?? {})) {
		if (reference.enabled === false || reference.source.type !== 'git')
			continue;
		void prepareGitReference(
			name,
			reference,
			cfg.paths.cacheDir,
			cfg.projectRoot,
		);
	}
}

/** Retry preparation for one Git reference after an explicit user action. */
export function retryReferencePreparation(
	name: string,
	reference: ReferenceConfig,
	cfg: OttoConfig,
): void {
	if (reference.enabled === false || reference.source.type !== 'git') return;
	void prepareGitReference(
		name,
		reference,
		cfg.paths.cacheDir,
		cfg.projectRoot,
		true,
	);
}

/** Delete an unreferenced cached Git clone after its config entry is removed. */
export async function deleteReferenceClone(
	name: string,
	reference: ReferenceConfig | undefined,
	cfg: OttoConfig,
): Promise<void> {
	if (reference?.source.type !== 'git') return;
	const deletedPaths = getGitReferencePaths(
		name,
		reference,
		cfg.paths.cacheDir,
		false,
	);
	const remainingReference = cfg.references?.[name];
	const cloneIsStillReferenced =
		remainingReference?.source.type === 'git' &&
		remainingReference.source.url.trim() === reference.source.url.trim() &&
		(remainingReference.source.ref ?? '') === (reference.source.ref ?? '');
	if (cloneIsStillReferenced) return;

	const pending = preparations.get(deletedPaths.key);
	if (pending) {
		pending.abortController.abort();
		await pending.promise;
	}
	preparationStates.delete(deletedPaths.key);
	await rm(deletedPaths.path, { recursive: true, force: true });
}

/** Read preparation state for configured references without waiting for clones. */
export async function getReferenceStatuses(
	cfg: OttoConfig,
): Promise<Record<string, ReferencePreparationStatus>> {
	const statuses: Record<string, ReferencePreparationStatus> = {};
	for (const [name, reference] of Object.entries(cfg.references ?? {})) {
		if (reference.source.type === 'local') {
			try {
				await resolveLocalReference(reference.source.path, cfg.projectRoot);
				statuses[name] = { status: 'available' };
			} catch (error) {
				statuses[name] = { status: 'error', error: toErrorMessage(error) };
			}
			continue;
		}
		const { key, path } = getGitReferencePaths(
			name,
			reference,
			cfg.paths.cacheDir,
		);
		const preparationState = preparationStates.get(key);
		if (
			preparationState?.status === 'cloning' ||
			preparationState?.status === 'error'
		) {
			statuses[name] = preparationState;
		} else if (await isDirectory(join(path, '.git'))) {
			statuses[name] = { status: 'available' };
		} else {
			statuses[name] = {
				status: 'error',
				error: 'Repository has not been cloned yet',
			};
		}
	}
	return statuses;
}

async function resolveLocalReference(
	configuredPath: string,
	projectRoot: string,
): Promise<string> {
	const expanded = configuredPath.startsWith('~/')
		? join(homedir(), configuredPath.slice(2))
		: configuredPath;
	const path = isAbsolute(expanded)
		? resolve(expanded)
		: resolve(projectRoot, expanded);
	const info = await stat(path);
	if (!info.isDirectory())
		throw new Error('Local reference is not a directory');
	return path;
}

async function resolveCachedGitReference(
	name: string,
	reference: ReferenceConfig,
	cacheDir: string,
): Promise<string> {
	const { path } = getGitReferencePaths(name, reference, cacheDir);
	if (!(await isDirectory(join(path, '.git')))) {
		throw new Error('Repository is still being prepared');
	}
	return path;
}

function getGitReferencePaths(
	name: string,
	reference: ReferenceConfig,
	cacheDir: string,
	validateUrl = true,
): { key: string; path: string; metadataPath: string; url: string } {
	if (reference.source.type !== 'git') throw new Error('Invalid Git reference');
	const url = reference.source.url.trim();
	if (validateUrl && !isSupportedGitReferenceUrl(url)) {
		throw new Error('Git URL must use HTTP(S) or SSH');
	}
	const hash = new Bun.CryptoHasher('sha256')
		.update(`${url}\0${reference.source.ref ?? ''}`)
		.digest('hex')
		.slice(0, 12);
	const safeName =
		name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48) || 'reference';
	const root = join(cacheDir, 'references');
	const path = join(root, `${safeName}-${hash}`);
	return {
		key: `${path}\0${url}\0${reference.source.ref ?? ''}`,
		path,
		metadataPath: join(path, '.otto-reference.json'),
		url,
	};
}

function prepareGitReference(
	name: string,
	reference: ReferenceConfig,
	cacheDir: string,
	projectRoot: string,
	force = false,
): Promise<void> {
	const paths = getGitReferencePaths(name, reference, cacheDir);
	const existing = preparations.get(paths.key);
	if (existing) return existing.promise;
	if (!force && preparationStates.get(paths.key)?.status === 'error') {
		return Promise.resolve();
	}
	const abortController = new AbortController();
	setPreparationState(paths.key, name, reference, projectRoot, {
		status: 'cloning',
		output: ['Starting Git preparation...'],
	});
	const pending = runGitPreparation(
		reference,
		paths,
		(line) => {
			appendPreparationOutput(paths.key, name, reference, projectRoot, line);
		},
		abortController.signal,
	)
		.then(() => {
			if (abortController.signal.aborted) return;
			setPreparationState(paths.key, name, reference, projectRoot, {
				status: 'available',
			});
		})
		.catch((error) => {
			if (abortController.signal.aborted) return;
			const output = preparationStates.get(paths.key)?.output;
			setPreparationState(paths.key, name, reference, projectRoot, {
				status: 'error',
				error: toErrorMessage(error),
				...(output ? { output } : {}),
			});
		})
		.finally(() => {
			if (preparations.get(paths.key)?.promise === pending) {
				preparations.delete(paths.key);
			}
		});
	preparations.set(paths.key, { promise: pending, abortController });
	return pending;
}

async function runGitPreparation(
	reference: ReferenceConfig,
	paths: { path: string; metadataPath: string; url: string },
	onOutput: (line: string) => void,
	signal: AbortSignal,
): Promise<void> {
	if (reference.source.type !== 'git') throw new Error('Invalid Git reference');
	const root = join(paths.path, '..');
	await mkdir(root, { recursive: true });

	if (!(await isDirectory(join(paths.path, '.git')))) {
		await rm(paths.path, { recursive: true, force: true });
		const args = ['clone', '--progress', '--depth', '1'];
		if (reference.source.ref) {
			args.push('--branch', reference.source.ref, '--single-branch');
		}
		args.push('--', paths.url, paths.path);
		onOutput('Cloning repository...');
		try {
			await runGit(args, onOutput, signal);
		} catch (error) {
			await rm(paths.path, { recursive: true, force: true });
			throw error;
		}
		await writeMetadata(paths.metadataPath);
		return;
	}

	if (await shouldRefresh(paths.metadataPath)) {
		try {
			const args = [
				'-C',
				paths.path,
				'fetch',
				'--progress',
				'--depth',
				'1',
				'origin',
			];
			if (reference.source.ref) args.push(reference.source.ref);
			onOutput('Fetching repository updates...');
			await runGit(args, onOutput, signal);
			onOutput('Updating cached checkout...');
			await runGit(
				['-C', paths.path, 'reset', '--hard', 'FETCH_HEAD'],
				onOutput,
				signal,
			);
		} catch {
			// Keep a usable stale clone when a background refresh fails.
		}
		await writeMetadata(paths.metadataPath);
	}
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

async function shouldRefresh(metadataPath: string): Promise<boolean> {
	try {
		const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as {
			updatedAt?: number;
		};
		return Date.now() - (metadata.updatedAt ?? 0) >= REFRESH_INTERVAL_MS;
	} catch {
		return true;
	}
}

async function writeMetadata(metadataPath: string): Promise<void> {
	await writeFile(metadataPath, JSON.stringify({ updatedAt: Date.now() }));
}

function setPreparationState(
	key: string,
	name: string,
	reference: ReferenceConfig,
	projectRoot: string,
	status: ReferencePreparationStatus,
): void {
	if (reference.source.type !== 'git') return;
	preparationStates.set(key, status);
	publishClientEvent({
		type: 'reference.preparation',
		payload: {
			name,
			url: reference.source.url,
			...(reference.source.ref ? { ref: reference.source.ref } : {}),
			projectRoot,
			...status,
		},
	});
}

function appendPreparationOutput(
	key: string,
	name: string,
	reference: ReferenceConfig,
	projectRoot: string,
	line: string,
): void {
	const state = preparationStates.get(key);
	if (state?.status !== 'cloning' || !line.trim()) return;
	setPreparationState(key, name, reference, projectRoot, {
		...state,
		output: [...(state.output ?? []), line.trimEnd()].slice(
			-MAX_GIT_OUTPUT_LINES,
		),
	});
}

async function runGit(
	args: string[],
	onOutput: (line: string) => void,
	signal: AbortSignal,
): Promise<void> {
	const process = Bun.spawn(['git', ...args], {
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			...Bun.env,
			GIT_TERMINAL_PROMPT: '0',
			GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=10',
		},
	});
	let timedOut = false;
	const abort = () => process.kill();
	signal.addEventListener('abort', abort, { once: true });
	const timeout = setTimeout(() => {
		timedOut = true;
		process.kill();
	}, GIT_TIMEOUT_MS);
	try {
		const [exitCode, stdout, stderr] = await Promise.all([
			process.exited,
			readGitOutput(process.stdout, onOutput),
			readGitOutput(process.stderr, onOutput),
		]);
		if (signal.aborted) throw new Error('Git operation cancelled');
		if (timedOut) throw new Error('Git operation timed out');
		if (exitCode !== 0) {
			throw new Error(
				stderr.trim() || stdout.trim() || `git exited with code ${exitCode}`,
			);
		}
	} finally {
		clearTimeout(timeout);
		signal.removeEventListener('abort', abort);
	}
}

async function readGitOutput(
	stream: ReadableStream<Uint8Array>,
	onOutput: (line: string) => void,
): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	const captured: string[] = [];
	let buffered = '';
	const emit = (line: string) => {
		if (!line.trim()) return;
		captured.push(line);
		if (captured.length > MAX_GIT_OUTPUT_LINES) captured.shift();
		onOutput(line);
	};
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffered += decoder.decode(value, { stream: true });
		const lines = buffered.split(/\r\n|\r|\n/);
		buffered = lines.pop() ?? '';
		for (const line of lines) emit(line);
	}
	buffered += decoder.decode();
	if (buffered) emit(buffered);
	return captured.join('\n');
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
