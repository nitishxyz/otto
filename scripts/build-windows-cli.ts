#!/usr/bin/env bun
/**
 * Build Windows CLI binary via cross-compilation.
 *
 * Bun supports cross-compiling to Windows from any platform via --target=bun-windows-x64.
 * This script automates the full flow: web UI build, embedded bins, and compile.
 *
 * Usage:
 *   bun run scripts/build-windows-cli.ts                  # Cross-compile from current OS
 *   bun run scripts/build-windows-cli.ts --docker         # Build inside Docker (for CI or isolation)
 *   bun run scripts/build-windows-cli.ts --verbose        # Show build output
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Spinner, GREEN, DIM, BOLD, CYAN, RESET } from './lib/spinner.ts';

const verbose = process.argv.includes('--verbose');
const useDocker = process.argv.includes('--docker');

const ROOT = join(import.meta.dir, '..');
const spinner = new Spinner();
const startTime = performance.now();

console.log(`\n${BOLD}${CYAN}otto${RESET} ${DIM}build-windows-cli${RESET}\n`);

if (useDocker) {
	spinner.begin('Building Windows CLI via Docker');
	const dockerfilePath = join(ROOT, 'docker', 'Dockerfile.windows-cli');

	if (!existsSync(dockerfilePath)) {
		spinner.fail();
		console.error('Dockerfile not found at docker/Dockerfile.windows-cli');
		process.exit(1);
	}

	const buildArgs = [
		'docker',
		'build',
		'-f',
		dockerfilePath,
		'-t',
		'otto-windows-cli-builder',
		ROOT,
	];

	const buildProc = Bun.spawnSync(buildArgs, {
		cwd: ROOT,
		stdout: verbose ? 'inherit' : 'pipe',
		stderr: verbose ? 'inherit' : 'pipe',
	});

	if (!buildProc.success) {
		spinner.fail();
		if (!verbose) {
			console.error(buildProc.stderr.toString());
		}
		process.exit(1);
	}

	const extractProc = Bun.spawnSync(
		[
			'docker',
			'run',
			'--rm',
			'-v',
			`${ROOT}/dist:/out`,
			'otto-windows-cli-builder',
			'sh',
			'-c',
			'cp /app/dist/otto-windows-x64.exe /out/',
		],
		{
			cwd: ROOT,
			stdout: verbose ? 'inherit' : 'pipe',
			stderr: verbose ? 'inherit' : 'pipe',
		},
	);

	if (!extractProc.success) {
		spinner.fail();
		if (!verbose) {
			console.error(extractProc.stderr.toString());
		}
		process.exit(1);
	}

	spinner.succeed('dist/otto-windows-x64.exe (via Docker)');
} else {
	spinner.begin('Building web UI');
	{
		const proc = Bun.spawnSync(
			[process.execPath, 'run', 'scripts/build-web.ts'],
			{
				cwd: ROOT,
				stdout: verbose ? 'inherit' : 'pipe',
				stderr: verbose ? 'inherit' : 'pipe',
			},
		);
		if (!proc.success) {
			spinner.fail();
			if (!verbose) console.error(proc.stderr.toString());
			process.exit(1);
		}
	}
	spinner.succeed();

	spinner.begin('Preparing embedded binaries (windows-x64)');
	{
		const proc = Bun.spawnSync(
			['bun', 'run', 'scripts/prepare-embedded-bins.ts', 'windows-x64'],
			{
				cwd: ROOT,
				stdout: verbose ? 'inherit' : 'pipe',
				stderr: verbose ? 'inherit' : 'pipe',
			},
		);
		if (!proc.success) {
			spinner.fail();
			if (!verbose) console.error(proc.stderr.toString());
			process.exit(1);
		}
	}
	spinner.succeed();

	spinner.begin('Cross-compiling Windows binary');
	mkdirSync(join(ROOT, 'dist'), { recursive: true });

	const outfile = 'dist/otto-windows-x64.exe';
	const buildCmd = [
		'bun',
		'build',
		'--compile',
		'--minify',
		'--define',
		'FFF_LIBC="gnu"',
		'--target=bun-windows-x64',
		'./apps/cli/index.ts',
		'--outfile',
		outfile,
	];

	{
		const proc = Bun.spawnSync(buildCmd, {
			cwd: ROOT,
			stdout: verbose ? 'inherit' : 'pipe',
			stderr: verbose ? 'inherit' : 'pipe',
		});
		if (!proc.success) {
			spinner.fail();
			if (!verbose) console.error(proc.stderr.toString());
			process.exit(1);
		}
	}
	spinner.succeed(outfile);
}

const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
console.log(
	`\n${GREEN}${BOLD}  ✓${RESET} Windows CLI build complete ${DIM}in ${elapsed}s${RESET}\n`,
);
