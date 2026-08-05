#!/usr/bin/env bun
import { mkdirSync } from 'node:fs';
import { Spinner, GREEN, DIM, BOLD, CYAN, RESET } from './lib/spinner.ts';

const verbose = process.argv.includes('--verbose');
const args = process.argv.slice(2).filter((a) => a !== '--verbose');
const target = args.find((a) => a.startsWith('--target='));

const startTime = performance.now();
const spinner = new Spinner();
const ROOT = import.meta.dir.replace(/[\\/]scripts$/, '');

console.log(`\n${BOLD}${CYAN}otto${RESET} ${DIM}compile${RESET}\n`);

spinner.begin('Building web UI');
const webArgs = verbose ? ['--verbose'] : [];

if (verbose) {
	spinner.succeed();
	const result = Bun.spawnSync(
		[process.execPath, 'run', 'scripts/build-web.ts', ...webArgs],
		{
			cwd: ROOT,
			stdout: 'inherit',
			stderr: 'inherit',
		},
	);
	if (!result.success) process.exit(1);
} else {
	const proc = Bun.spawn(
		[process.execPath, 'run', 'scripts/build-web.ts', ...webArgs],
		{
			cwd: ROOT,
			stdout: 'pipe',
			stderr: 'pipe',
		},
	);
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		spinner.fail();
		const out =
			(await new Response(proc.stderr).text()).trim() ||
			(await new Response(proc.stdout).text()).trim();
		if (out) console.error(out);
		process.exit(1);
	}
	spinner.succeed();
}

spinner.begin('Preparing embedded binaries');
const prepareTarget = target ? target.replace('--target=bun-', '') : undefined;
const prepareArgs = ['bun', 'run', 'scripts/prepare-embedded-bins.ts'];
if (prepareTarget) prepareArgs.push(prepareTarget);
{
	const proc = Bun.spawn(prepareArgs, {
		cwd: ROOT,
		stdout: verbose ? 'inherit' : 'pipe',
		stderr: verbose ? 'inherit' : 'pipe',
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		spinner.fail();
		if (!verbose) {
			const out =
				(await new Response(proc.stderr).text()).trim() ||
				(await new Response(proc.stdout).text()).trim();
			if (out) console.error(out);
		}
		process.exit(1);
	}
}
spinner.succeed();

spinner.begin('Building curated browser runtime');
{
	const proc = Bun.spawn(
		[process.execPath, 'run', 'scripts/build-curated-browser-runtime.ts'],
		{
			cwd: ROOT,
			stdout: verbose ? 'inherit' : 'pipe',
			stderr: verbose ? 'inherit' : 'pipe',
		},
	);
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		spinner.fail();
		if (!verbose) {
			const out =
				(await new Response(proc.stderr).text()).trim() ||
				(await new Response(proc.stdout).text()).trim();
			if (out) console.error(out);
		}
		process.exit(1);
	}
}
spinner.succeed();

spinner.begin('Compiling binary');
mkdirSync('dist', { recursive: true });

const buildCmd = ['bun', 'build', '--compile', '--minify'];
if (target) buildCmd.push(target);
const targetKey = target ? target.replace('--target=bun-', '') : null;
const isWindowsTarget =
	targetKey?.startsWith('windows-') ?? process.platform === 'win32';
const outfile = targetKey
	? `dist/otto-${targetKey}${isWindowsTarget ? '.exe' : ''}`
	: `dist/otto${process.platform === 'win32' ? '.exe' : ''}`;
buildCmd.push('./apps/cli/index.ts', '--outfile', outfile);

if (verbose) {
	spinner.succeed();
	const result = Bun.spawnSync(buildCmd, {
		cwd: ROOT,
		stdout: 'inherit',
		stderr: 'inherit',
	});
	if (!result.success) process.exit(1);
} else {
	const proc = Bun.spawn(buildCmd, {
		cwd: ROOT,
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		spinner.fail();
		const out =
			(await new Response(proc.stderr).text()).trim() ||
			(await new Response(proc.stdout).text()).trim();
		if (out) console.error(out);
		process.exit(1);
	}
}
spinner.succeed(outfile);

const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
console.log(
	`\n${GREEN}${BOLD}  ✓${RESET} Build complete ${DIM}in ${elapsed}s${RESET}\n`,
);
