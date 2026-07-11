import { spawn, execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import {
	clearCachedBinaries,
	getCachedBinary,
	setCachedBinary,
} from './bin-manager/cache.ts';
import { fileExists, isExecutable } from './bin-manager/filesystem.ts';
import { getAgiBinDir, getBinaryFileName } from './bin-manager/paths.ts';
import { extractFromVendor } from './bin-manager/vendor.ts';

let cachedLoginPath: {
	key: string;
	path: string | null;
} | null = null;

let cachedLoginEnv: {
	key: string;
	env: NodeJS.ProcessEnv | null;
} | null = null;

export type ShellEnvMode = 'minimal' | 'login-cache' | 'login-fresh';
type ShellEnvModeInput = ShellEnvMode | 'fast';

const ENV_JSON_START = '___OTTO_ENV_JSON_START___';
const ENV_JSON_END = '___OTTO_ENV_JSON_END___';

export { getAgiBinDir } from './bin-manager/paths.ts';

async function whichBinary(name: string): Promise<string | null> {
	const cmd = process.platform === 'win32' ? 'where' : 'which';
	return new Promise((resolve) => {
		const proc = spawn(cmd, [name], { stdio: ['ignore', 'pipe', 'ignore'] });
		let stdout = '';
		proc.stdout.on('data', (d) => {
			stdout += d.toString();
		});
		proc.on('close', (code) => {
			if (code === 0 && stdout.trim()) resolve(stdout.trim().split('\n')[0]);
			else resolve(null);
		});
		proc.on('error', () => resolve(null));
	});
}

export async function resolveBinary(name: string): Promise<string> {
	const cached = getCachedBinary(name);
	if (cached) return cached;

	const binaryName = getBinaryFileName(name);
	const binDir = getAgiBinDir();
	const installedPath = join(binDir, binaryName);
	if (
		(await fileExists(installedPath)) &&
		(await isExecutable(installedPath))
	) {
		setCachedBinary(name, installedPath);
		return installedPath;
	}

	const vendorPath = await extractFromVendor(name);
	if (vendorPath) {
		setCachedBinary(name, vendorPath);
		return vendorPath;
	}

	const systemPath = await whichBinary(binaryName);
	if (systemPath) {
		setCachedBinary(name, systemPath);
		return systemPath;
	}

	return binaryName;
}

export function clearBinaryCache(): void {
	clearCachedBinaries();
}

function resolveShellExecutable(candidate: string): string | null {
	const paths = candidate.includes('/') ? [candidate] : [];
	const name = basename(candidate);
	for (const directory of (process.env.PATH || '').split(delimiter)) {
		if (directory) paths.push(join(directory, name));
	}

	for (const path of paths) {
		try {
			accessSync(path, constants.X_OK);
			return path;
		} catch {}
	}
	return null;
}

export function getUserShell(): string {
	if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe';

	const candidates = [process.env.SHELL, 'zsh', 'bash', 'sh'].filter(
		(candidate): candidate is string => Boolean(candidate),
	);
	for (const candidate of candidates) {
		const shell = resolveShellExecutable(candidate);
		if (shell) return shell;
	}
	return 'sh';
}

export function getShellExecutionConfig(
	cmd: string,
	options?: { envMode?: ShellEnvModeInput },
): {
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
};
export function getShellExecutionConfig(
	cmd: string,
	options: { envMode?: ShellEnvModeInput } = {},
): {
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
} {
	const envMode = normalizeShellEnvMode(options.envMode);
	const loginEnv =
		envMode === 'minimal' ? null : getLoginShellEnv(envMode === 'login-fresh');
	const env = {
		...process.env,
		...(loginEnv ?? {}),
		PATH: mergePaths([
			getAgiBinDir(),
			loginEnv?.PATH,
			getLoginShellPath(),
			process.env.PATH,
		]),
	};
	if (process.platform === 'win32') {
		return {
			command: getUserShell(),
			args: ['/d', '/s', '/c', cmd],
			env,
		};
	}

	const command = getUserShell();
	return {
		command,
		args: ['-c', 'eval "$OTTO_SHELL_COMMAND"'],
		env: { ...env, OTTO_SHELL_COMMAND: cmd },
	};
}

function normalizeShellEnvMode(envMode?: ShellEnvModeInput): ShellEnvMode {
	if (envMode === 'fast') return 'minimal';
	return envMode ?? 'login-cache';
}

function getLoginShellEnv(refresh: boolean): NodeJS.ProcessEnv | null {
	const home = process.env.HOME || homedir();
	const userShell = getUserShell();
	const cacheKey = [home, userShell, process.env.PATH || ''].join('\0');
	if (!refresh && cachedLoginEnv?.key === cacheKey) return cachedLoginEnv.env;

	if (process.platform === 'win32') {
		cachedLoginEnv = { key: cacheKey, env: { ...process.env } };
		return cachedLoginEnv.env;
	}
	try {
		const output = execFileSync(
			userShell,
			[
				'-ic',
				`printf '%s\n' ${JSON.stringify(ENV_JSON_START)}; env; printf '%s\n' ${JSON.stringify(ENV_JSON_END)}`,
			],
			{
				timeout: 10000,
				stdio: ['ignore', 'pipe', 'ignore'],
				env: {
					...process.env,
					HOME: home,
					USER: process.env.USER || '',
					SHELL: userShell,
				},
			},
		).toString();
		const start = output.indexOf(ENV_JSON_START);
		const end = output.indexOf(ENV_JSON_END, start + ENV_JSON_START.length);
		if (start >= 0 && end > start) {
			const env: NodeJS.ProcessEnv = {};
			const body = output.slice(start + ENV_JSON_START.length, end).trim();
			for (const line of body.split('\n')) {
				const separator = line.indexOf('=');
				if (separator <= 0) continue;
				env[line.slice(0, separator)] = line.slice(separator + 1);
			}
			cachedLoginEnv = { key: cacheKey, env };
			return env;
		}
	} catch {}
	return null;
}

function getLoginShellPath(): string | null {
	const home = process.env.HOME || homedir();
	const userShell = getUserShell();
	const cacheKey = [home, userShell, process.env.PATH || ''].join('\0');
	if (cachedLoginPath?.key === cacheKey) return cachedLoginPath.path;

	if (process.platform === 'win32') {
		cachedLoginPath = { key: cacheKey, path: process.env.PATH || '' };
		return cachedLoginPath.path;
	}

	const shellCandidates = [
		process.env.SHELL,
		'/bin/zsh',
		'/bin/bash',
		'/bin/sh',
	].filter(Boolean) as string[];

	for (const shell of shellCandidates) {
		try {
			const result = execFileSync(shell, ['-lc', 'echo "___PATH___:$PATH"'], {
				timeout: 1500,
				stdio: ['ignore', 'pipe', 'ignore'],
				env: {
					...process.env,
					HOME: home,
					USER: process.env.USER || '',
					SHELL: shell,
				},
			});
			const output = result.toString();
			const match = output.match(/___PATH___:(.*)/);
			if (match?.[1]?.trim()) {
				cachedLoginPath = { key: cacheKey, path: match[1].trim() };
				return cachedLoginPath.path;
			}
		} catch {}
	}

	cachedLoginPath = { key: cacheKey, path: null };
	return null;
}

export function getAugmentedPath(): string {
	return mergePaths([getAgiBinDir(), getLoginShellPath(), process.env.PATH]);
}

function mergePaths(paths: Array<string | null | undefined>): string {
	const sep = process.platform === 'win32' ? ';' : ':';
	const seen = new Set<string>();
	const parts: string[] = [];

	for (const p of paths.flatMap((path) => (path ? path.split(sep) : []))) {
		if (p && !seen.has(p)) {
			seen.add(p);
			parts.push(p);
		}
	}

	return parts.join(sep);
}
