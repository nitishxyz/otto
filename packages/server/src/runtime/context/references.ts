import type { OttoConfig, ReferenceConfig } from '@ottocode/sdk';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GIT_TIMEOUT_MS = 15_000;
const preparations = new Map<string, Promise<void>>();
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
		void prepareGitReference(name, reference, cfg.paths.cacheDir);
	}
}

/** Retry preparation for one Git reference after an explicit user action. */
export function retryReferencePreparation(
	name: string,
	reference: ReferenceConfig,
	cfg: OttoConfig,
): void {
	if (reference.enabled === false || reference.source.type !== 'git') return;
	void prepareGitReference(name, reference, cfg.paths.cacheDir, true);
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
		if (await isDirectory(join(path, '.git'))) {
			statuses[name] = { status: 'available' };
		} else {
			statuses[name] = preparationStates.get(key) ?? {
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
): { key: string; path: string; metadataPath: string; url: string } {
	if (reference.source.type !== 'git') throw new Error('Invalid Git reference');
	const url = reference.source.url.trim();
	if (!url) throw new Error('Git URL is required');
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
	force = false,
): Promise<void> {
	const paths = getGitReferencePaths(name, reference, cacheDir);
	const existing = preparations.get(paths.key);
	if (existing) return existing;
	if (!force && preparationStates.get(paths.key)?.status === 'error') {
		return Promise.resolve();
	}
	preparationStates.set(paths.key, { status: 'cloning' });
	const pending = runGitPreparation(reference, paths)
		.then(() => {
			preparationStates.set(paths.key, { status: 'available' });
		})
		.catch((error) => {
			preparationStates.set(paths.key, {
				status: 'error',
				error: toErrorMessage(error),
			});
		})
		.finally(() => {
			preparations.delete(paths.key);
		});
	preparations.set(paths.key, pending);
	return pending;
}

async function runGitPreparation(
	reference: ReferenceConfig,
	paths: { path: string; metadataPath: string; url: string },
): Promise<void> {
	if (reference.source.type !== 'git') throw new Error('Invalid Git reference');
	const root = join(paths.path, '..');
	await mkdir(root, { recursive: true });

	if (!(await isDirectory(join(paths.path, '.git')))) {
		await rm(paths.path, { recursive: true, force: true });
		const args = ['clone', '--depth', '1'];
		if (reference.source.ref) {
			args.push('--branch', reference.source.ref, '--single-branch');
		}
		args.push('--', paths.url, paths.path);
		try {
			await runGit(args);
		} catch (error) {
			await rm(paths.path, { recursive: true, force: true });
			throw error;
		}
		await writeMetadata(paths.metadataPath);
		return;
	}

	if (await shouldRefresh(paths.metadataPath)) {
		try {
			const args = ['-C', paths.path, 'fetch', '--depth', '1', 'origin'];
			if (reference.source.ref) args.push(reference.source.ref);
			await runGit(args);
			await runGit(['-C', paths.path, 'reset', '--hard', 'FETCH_HEAD']);
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

async function runGit(args: string[]): Promise<void> {
	const process = Bun.spawn(['git', ...args], {
		stdin: 'ignore',
		stdout: 'ignore',
		stderr: 'pipe',
		env: {
			...Bun.env,
			GIT_TERMINAL_PROMPT: '0',
			GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=10',
		},
	});
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		process.kill();
	}, GIT_TIMEOUT_MS);
	try {
		const exitCode = await process.exited;
		if (timedOut) throw new Error('Git operation timed out');
		if (exitCode !== 0) {
			const stderr = await new Response(process.stderr).text();
			throw new Error(stderr.trim() || `git exited with code ${exitCode}`);
		}
	} finally {
		clearTimeout(timeout);
	}
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
