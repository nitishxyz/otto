import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { simulatorRuntime } from './state.ts';
import type { ServeSimCommand, ServeSimCommandResult } from './types.ts';

const SERVE_SIM_PACKAGE = 'serve-sim@latest';

function getAgiBinDir() {
	const cfgHome = process.env.XDG_CONFIG_HOME;
	const home = process.env.HOME || process.env.USERPROFILE || '';
	const configBase = cfgHome?.trim() || join(home, '.config');
	return join(configBase, 'otto', 'bin');
}

function executableName(name: string): string {
	return process.platform === 'win32' ? `${name}.exe` : name;
}

function findExecutable(name: string): string | null {
	const binary = executableName(name);
	const pathDirs = (process.env.PATH || '').split(
		process.platform === 'win32' ? ';' : ':',
	);
	const home = process.env.HOME || process.env.USERPROFILE || '';
	const candidates = [
		...pathDirs.map((dir) => join(dir, binary)),
		...(home ? [join(home, '.bun', 'bin', binary)] : []),
		join('/opt', 'homebrew', 'bin', binary),
		join('/usr', 'local', 'bin', binary),
		join('/usr', 'bin', binary),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function resolveConfiguredServeSim(): ServeSimCommand | null {
	const configured = process.env.OTTO_SERVE_SIM_BIN?.trim();
	if (!configured) return null;
	const command = isAbsolute(configured) ? configured : configured;
	return existsSync(command) || !isAbsolute(command)
		? { command, argsPrefix: [], cwd: dirname(command), runner: 'custom' }
		: null;
}

function resolvePackageRunner(): ServeSimCommand | null {
	const bun = findExecutable('bun');
	if (bun) {
		return {
			command: bun,
			argsPrefix: ['x', SERVE_SIM_PACKAGE],
			runner: 'bun x serve-sim@latest',
		};
	}

	const npx = findExecutable('npx');
	if (npx) {
		return {
			command: npx,
			argsPrefix: ['--yes', SERVE_SIM_PACKAGE],
			runner: 'npx --yes serve-sim@latest',
		};
	}

	return null;
}

function resolveLegacyServeSim(): ServeSimCommand | null {
	const installedBin = join(getAgiBinDir(), executableName('serve-sim'));
	if (!existsSync(installedBin)) return null;
	return {
		command: installedBin,
		argsPrefix: [],
		cwd: dirname(installedBin),
		runner: installedBin,
	};
}

function resolvePathServeSim(): ServeSimCommand | null {
	const serveSim = findExecutable('serve-sim');
	if (!serveSim) return null;
	return {
		command: serveSim,
		argsPrefix: [],
		cwd: dirname(serveSim),
		runner: serveSim,
	};
}

export function findServeSimCommand(): ServeSimCommand {
	if (simulatorRuntime.serveSimCommand) return simulatorRuntime.serveSimCommand;

	const resolved =
		resolveConfiguredServeSim() ??
		resolvePackageRunner() ??
		resolvePathServeSim() ??
		resolveLegacyServeSim();
	if (resolved) {
		simulatorRuntime.serveSimCommand = resolved;
		return resolved;
	}

	throw new Error(
		'serve-sim requires Bun or npm. Install Bun or Node.js, then try the mobile preview again.',
	);
}

export function getServeSimAvailability() {
	if (process.platform !== 'darwin') {
		return {
			setupStatus: 'unsupported' as const,
			setupMessage: 'serve-sim requires macOS with Xcode command line tools',
			runner: null,
		};
	}

	try {
		const command = findServeSimCommand();
		return {
			setupStatus: 'ready' as const,
			setupMessage: null,
			runner: command.runner,
		};
	} catch (error) {
		return {
			setupStatus: 'missing_runner' as const,
			setupMessage:
				error instanceof Error
					? error.message
					: 'serve-sim requires Bun or npm.',
			runner: null,
		};
	}
}

export function serveSimSpawnArgs(args: string[]) {
	const resolvedCommand = findServeSimCommand();
	return {
		cmd: [resolvedCommand.command, ...resolvedCommand.argsPrefix, ...args],
		cwd: resolvedCommand.cwd,
	};
}

export async function runServeSim(
	args: string[],
): Promise<ServeSimCommandResult> {
	const resolved = serveSimSpawnArgs(args);
	const proc = Bun.spawn(resolved.cmd, {
		stdout: 'pipe',
		stderr: 'pipe',
		cwd: resolved.cwd,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}
