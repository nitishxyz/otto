import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);
const loginEnvFlights = new Map<string, Promise<NodeJS.ProcessEnv | null>>();

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
	const env = getShellEnvironment(options);
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

/** Return the current environment snapshot; await getShellEnvironmentAsync for first-use discovery. */
export function getShellEnvironment(
	options: { envMode?: ShellEnvModeInput } = {},
): Record<string, string> {
	const envMode = normalizeShellEnvMode(options.envMode);
	const loginEnv = envMode === 'minimal' ? null : getLoginShellEnv();
	const values: NodeJS.ProcessEnv = {
		...process.env,
		...(loginEnv ?? {}),
		PATH: getAugmentedPath(),
	};
	return Object.fromEntries(
		Object.entries(values).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
}

function normalizeShellEnvMode(envMode?: ShellEnvModeInput): ShellEnvMode {
	if (envMode === 'fast') return 'minimal';
	return envMode ?? 'login-cache';
}

function shellEnvironmentKey(): string {
	return [
		process.env.HOME || homedir(),
		getUserShell(),
		process.env.PATH || '',
	].join('\0');
}

function getLoginShellEnv(): NodeJS.ProcessEnv | null {
	const key = shellEnvironmentKey();
	return cachedLoginEnv?.key === key ? cachedLoginEnv.env : null;
}

function discoverLoginShellEnv(
	refresh: boolean,
): Promise<NodeJS.ProcessEnv | null> {
	const key = shellEnvironmentKey();
	const existing = loginEnvFlights.get(key);
	if (existing) return existing;
	if (!refresh && cachedLoginEnv?.key === key)
		return Promise.resolve(cachedLoginEnv.env);
	const pending = (async () => {
		let env: NodeJS.ProcessEnv | null = null;
		try {
			if (process.platform === 'win32') env = { ...process.env };
			else {
				const { stdout } = await execFileAsync(
					getUserShell(),
					[
						'-ic',
						`printf '%s\\n' ${JSON.stringify(ENV_JSON_START)}; env; printf '%s\\n' ${JSON.stringify(ENV_JSON_END)}`,
					],
					{
						timeout: 10000,
						maxBuffer: 512 * 1024,
						env: { ...process.env, HOME: process.env.HOME || homedir() },
					},
				);
				const start = stdout.indexOf(ENV_JSON_START);
				const end = stdout.indexOf(ENV_JSON_END, start + ENV_JSON_START.length);
				if (start >= 0 && end > start) {
					env = {};
					for (const line of stdout
						.slice(start + ENV_JSON_START.length, end)
						.trim()
						.split('\n')) {
						const separator = line.indexOf('=');
						if (separator > 0)
							env[line.slice(0, separator)] = line.slice(separator + 1);
					}
				}
			}
		} catch {}
		cachedLoginEnv = { key, env };
		return env;
	})().finally(() => loginEnvFlights.delete(key));
	loginEnvFlights.set(key, pending);
	return pending;
}

/** Await single-flight login discovery before constructing the portable environment. */
export async function getShellEnvironmentAsync(
	options: { envMode?: ShellEnvModeInput } = {},
): Promise<Record<string, string>> {
	const mode = normalizeShellEnvMode(options.envMode);
	if (mode !== 'minimal') await discoverLoginShellEnv(mode === 'login-fresh');
	return getShellEnvironment({
		envMode: mode === 'login-fresh' ? 'login-cache' : mode,
	});
}

/** Await memoized discovery; synchronous APIs use the current snapshot without blocking. */
export async function getShellExecutionConfigAsync(
	cmd: string,
	options: { envMode?: ShellEnvModeInput } = {},
): Promise<ReturnType<typeof getShellExecutionConfig>> {
	const mode = normalizeShellEnvMode(options.envMode);
	if (mode !== 'minimal') await discoverLoginShellEnv(mode === 'login-fresh');
	return getShellExecutionConfig(cmd, {
		envMode: mode === 'login-fresh' ? 'login-cache' : mode,
	});
}

export function getAugmentedPath(): string {
	return mergePaths([
		getAgiBinDir(),
		getLoginShellEnv()?.PATH,
		process.env.PATH,
	]);
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
