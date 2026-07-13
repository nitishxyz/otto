import type { OttoConfig, ReferenceConfig } from '@ottocode/sdk';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GIT_TIMEOUT_MS = 15_000;
const inFlight = new Map<string, Promise<ResolvedReference>>();

export type ResolvedReference = {
	name: string;
	description: string;
	path?: string;
	status: 'available' | 'unavailable';
	error?: string;
};

/** Resolve enabled local and Git references into agent-readable directories. */
export async function resolveReferences(
	cfg: OttoConfig,
): Promise<ResolvedReference[]> {
	const entries = Object.entries(cfg.references ?? {}).filter(
		([, reference]) => reference.enabled !== false,
	);
	return Promise.all(
		entries.map(([name, reference]) =>
			resolveReferenceOnce(name, reference, cfg),
		),
	);
}

function resolveReferenceOnce(
	name: string,
	reference: ReferenceConfig,
	cfg: OttoConfig,
): Promise<ResolvedReference> {
	const key = `${cfg.projectRoot}\0${name}\0${JSON.stringify(reference)}`;
	const existing = inFlight.get(key);
	if (existing) return existing;
	const pending = resolveReference(name, reference, cfg).finally(() => {
		inFlight.delete(key);
	});
	inFlight.set(key, pending);
	return pending;
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
				: await resolveGitReference(name, reference, cfg.paths.cacheDir);
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

async function resolveGitReference(
	name: string,
	reference: ReferenceConfig,
	cacheDir: string,
): Promise<string> {
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
	const metadataPath = join(path, '.otto-reference.json');
	await mkdir(root, { recursive: true });

	if (!(await isDirectory(join(path, '.git')))) {
		const args = ['clone', '--depth', '1'];
		if (reference.source.ref) {
			args.push('--branch', reference.source.ref, '--single-branch');
		}
		args.push('--', url, path);
		await runGit(args);
		await writeMetadata(metadataPath);
		return path;
	}

	if (await shouldRefresh(metadataPath)) {
		try {
			const args = ['-C', path, 'fetch', '--depth', '1', 'origin'];
			if (reference.source.ref) args.push(reference.source.ref);
			await runGit(args);
			await runGit(['-C', path, 'reset', '--hard', 'FETCH_HEAD']);
		} catch {
			// Keep a usable stale clone and avoid retrying a failed network fetch per turn.
		}
		await writeMetadata(metadataPath);
	}
	return path;
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
		stdout: 'ignore',
		stderr: 'pipe',
		env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0' },
	});
	const timeout = setTimeout(() => process.kill(), GIT_TIMEOUT_MS);
	try {
		const exitCode = await process.exited;
		if (exitCode !== 0) {
			const stderr = await new Response(process.stderr).text();
			throw new Error(stderr.trim() || `git exited with code ${exitCode}`);
		}
	} finally {
		clearTimeout(timeout);
	}
}
