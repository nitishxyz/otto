import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { simulatorRuntime } from './state.ts';
import type { ServeSimCommand, ServeSimCommandResult } from './types.ts';

function getAgiBinDir() {
	const cfgHome = process.env.XDG_CONFIG_HOME;
	const home = process.env.HOME || process.env.USERPROFILE || '';
	const configBase = cfgHome?.trim() || join(home, '.config');
	return join(configBase, 'otto', 'bin');
}

export function findServeSimCommand(): ServeSimCommand {
	if (simulatorRuntime.serveSimCommand) return simulatorRuntime.serveSimCommand;

	const installedBin = join(getAgiBinDir(), 'serve-sim');
	if (existsSync(installedBin)) {
		simulatorRuntime.serveSimCommand = {
			command: installedBin,
			cwd: dirname(installedBin),
		};
		return simulatorRuntime.serveSimCommand;
	}

	throw new Error(
		`Embedded serve-sim binary is not installed at ${installedBin}. Rebuild or restart Otto so bundled binaries are bootstrapped.`,
	);
}

export function serveSimSpawnArgs(args: string[]) {
	const resolvedCommand = findServeSimCommand();
	return {
		cmd: [resolvedCommand.command, ...args],
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
