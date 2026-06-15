import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
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

export function getUserShell(): string {
	if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe';
	return process.env.SHELL || '/bin/bash';
}

export function getShellExecutionConfig(cmd: string): {
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
} {
	const env = { ...process.env, PATH: getAugmentedPath() };
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
	const sep = process.platform === 'win32' ? ';' : ':';
	const binDir = getAgiBinDir();
	const current = process.env.PATH || '';
	const loginPath = getLoginShellPath();

	const seen = new Set<string>();
	const parts: string[] = [];

	for (const p of [
		binDir,
		...(loginPath ? loginPath.split(sep) : []),
		...current.split(sep),
	]) {
		if (p && !seen.has(p)) {
			seen.add(p);
			parts.push(p);
		}
	}

	return parts.join(sep);
}
