import { join } from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { homedir } from 'node:os';
import {
	clearCachedBinaries,
	getCachedBinary,
	setCachedBinary,
} from './bin-manager/cache.ts';
import { fileExists, isExecutable } from './bin-manager/filesystem.ts';
import { getAgiBinDir, getBinaryFileName } from './bin-manager/paths.ts';
import { extractFromVendor } from './bin-manager/vendor.ts';

let cachedLoginPath: string | null = null;

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

function getLoginShellPath(): string | null {
	if (cachedLoginPath !== null) return cachedLoginPath;

	if (process.platform === 'win32') {
		cachedLoginPath = process.env.PATH || '';
		return cachedLoginPath;
	}

	const home = process.env.HOME || homedir();
	const shellCandidates = [
		process.env.SHELL,
		'/bin/zsh',
		'/bin/bash',
		'/bin/sh',
	].filter(Boolean) as string[];

	for (const shell of shellCandidates) {
		try {
			const result = execSync(`${shell} -ilc 'echo "___PATH___:$PATH"'`, {
				timeout: 5000,
				stdio: ['ignore', 'pipe', 'ignore'],
				env: { HOME: home, USER: process.env.USER || '', SHELL: shell },
			});
			const output = result.toString();
			const match = output.match(/___PATH___:(.*)/);
			if (match?.[1]?.trim()) {
				cachedLoginPath = match[1].trim();
				return cachedLoginPath;
			}
		} catch {}
	}

	cachedLoginPath = null;
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
