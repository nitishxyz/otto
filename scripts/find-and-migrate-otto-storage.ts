#!/usr/bin/env bun
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Options {
	execute: boolean;
	includeHidden: boolean;
	roots: string[];
}

interface Summary {
	permissionErrors: number;
	prunedDirectories: number;
	scanErrors: number;
}

interface MigrationResult {
	projectDir: string;
	exitCode: number;
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, 'apps/cli/index.ts');
const homeDir = homedir();
const defaultRoots = [homeDir];
const noisyDirectoryNames = new Set([
	'.cache',
	'.git',
	'Applications',
	'Library',
	'build',
	'dist',
	'node_modules',
]);
const rootOnlyPruneNames = new Set([
	'.DocumentRevisions-V100',
	'.Spotlight-V100',
	'.TemporaryItems',
	'.Trashes',
	'.fseventsd',
	'Network',
	'System',
	'Volumes',
	'bin',
	'cores',
	'dev',
	'etc',
	'private',
	'sbin',
	'tmp',
	'usr',
	'var',
]);

function usage(): string {
	return `Find otto project directories and optionally migrate legacy storage.

Usage:
  bun run scripts/find-and-migrate-otto-storage.ts [options]
  bun run storage:migrate-all -- [options]

Options:
  --root <path>        Root to scan. May be repeated. Defaults to HOME.
  --execute            Run migration cleanup in each discovered project.
  --include-hidden     Recurse into hidden directories other than .otto.
  -h, --help           Show this help.

By default this is a dry run: it lists directories that contain an immediate .otto child.
To scan the whole machine, pass --root / explicitly. This can be slow and noisy.
Execute mode runs this command from each discovered project directory:
  bun run ${cliPath} storage migrate --delete-legacy
`;
}

function parseArgs(args: string[]): Options {
	const options: Options = {
		execute: false,
		includeHidden: false,
		roots: [],
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--execute') {
			options.execute = true;
			continue;
		}
		if (arg === '--include-hidden') {
			options.includeHidden = true;
			continue;
		}
		if (arg === '--root') {
			const root = args[index + 1];
			if (!root) {
				throw new Error('--root requires a path');
			}
			options.roots.push(root);
			index += 1;
			continue;
		}
		if (arg.startsWith('--root=')) {
			const root = arg.slice('--root='.length);
			if (!root) {
				throw new Error('--root requires a path');
			}
			options.roots.push(root);
			continue;
		}
		if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		}
		throw new Error(`Unknown option: ${arg}`);
	}

	if (options.roots.length === 0) {
		options.roots = defaultRoots;
	}

	return options;
}

function expandPath(path: string): string {
	if (path === '~') {
		return homeDir;
	}
	if (path.startsWith('~/')) {
		return join(homeDir, path.slice(2));
	}
	return path;
}

async function safeRealpath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		return resolve(expandPath(path));
	}
}

async function knownOttoStatePaths(): Promise<Set<string>> {
	return new Set(
		await Promise.all([
			safeRealpath(join(homeDir, '.otto')),
			safeRealpath(join(homeDir, '.local/state/otto')),
		]),
	);
}

function isWithin(path: string, parent: string): boolean {
	return path === parent || path.startsWith(`${parent}/`);
}

function isHiddenDirectory(name: string): boolean {
	return name.startsWith('.') && name !== '.' && name !== '..';
}

function shouldPruneDirectory(
	path: string,
	name: string,
	root: string,
	options: Options,
	statePaths: Set<string>,
): boolean {
	if (name === '.otto') {
		return true;
	}
	if (
		statePaths.has(path) ||
		[...statePaths].some((statePath) => isWithin(path, statePath))
	) {
		return true;
	}
	if (noisyDirectoryNames.has(name)) {
		return true;
	}
	if (root === '/' && rootOnlyPruneNames.has(name)) {
		return true;
	}
	if (!options.includeHidden && isHiddenDirectory(name)) {
		return true;
	}
	return false;
}

async function hasOttoChild(
	dir: string,
	statePaths: Set<string>,
): Promise<boolean> {
	const ottoDir = join(dir, '.otto');
	const resolvedOttoDir = await safeRealpath(ottoDir);
	if (statePaths.has(resolvedOttoDir)) {
		return false;
	}
	try {
		return (await stat(ottoDir)).isDirectory();
	} catch {
		return false;
	}
}

async function scanRoot(
	rootInput: string,
	options: Options,
	statePaths: Set<string>,
	summary: Summary,
): Promise<string[]> {
	const root = await safeRealpath(rootInput);
	const projects: string[] = [];
	const stack = [root];
	const visited = new Set<string>();

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || visited.has(current)) {
			continue;
		}
		visited.add(current);

		if (
			statePaths.has(current) ||
			[...statePaths].some((statePath) => isWithin(current, statePath))
		) {
			summary.prunedDirectories += 1;
			continue;
		}

		let currentStat: Awaited<ReturnType<typeof stat>>;
		try {
			currentStat = await stat(current);
		} catch (error) {
			summary.scanErrors += 1;
			console.warn(`Skipping unreadable path: ${current} (${String(error)})`);
			continue;
		}
		if (!currentStat.isDirectory()) {
			continue;
		}

		if (await hasOttoChild(current, statePaths)) {
			projects.push(current);
		}

		let entries: Awaited<ReturnType<typeof readdir>>;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch (error) {
			const code =
				error instanceof Error && 'code' in error ? String(error.code) : '';
			if (code === 'EACCES' || code === 'EPERM') {
				summary.permissionErrors += 1;
			} else {
				summary.scanErrors += 1;
			}
			continue;
		}

		for (const entry of entries) {
			if (!entry.isDirectory() || entry.isSymbolicLink()) {
				continue;
			}
			const child = join(current, entry.name);
			const childPath = await safeRealpath(child);
			if (
				shouldPruneDirectory(childPath, entry.name, root, options, statePaths)
			) {
				summary.prunedDirectories += 1;
				continue;
			}
			stack.push(childPath);
		}
	}

	return projects;
}

async function runMigration(projectDir: string): Promise<MigrationResult> {
	console.log(`\nMigrating: ${projectDir}`);
	const proc = Bun.spawn(
		['bun', 'run', cliPath, 'storage', 'migrate', '--delete-legacy'],
		{
			cwd: projectDir,
			stdout: 'inherit',
			stderr: 'inherit',
		},
	);
	const exitCode = await proc.exited;
	return { projectDir, exitCode };
}

async function main() {
	let options: Options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.error(`\n${usage()}`);
		process.exit(1);
	}

	const statePaths = await knownOttoStatePaths();
	const summary: Summary = {
		permissionErrors: 0,
		prunedDirectories: 0,
		scanErrors: 0,
	};
	const roots = options.roots.map((root) => resolve(expandPath(root)));

	console.log('otto storage bulk migration helper');
	console.log(`Mode: ${options.execute ? 'execute' : 'dry-run'}`);
	console.log(`Roots: ${roots.join(', ')}`);
	console.log(`Command: bun run ${cliPath} storage migrate --delete-legacy`);

	const projectSet = new Set<string>();
	for (const root of roots) {
		const projects = await scanRoot(root, options, statePaths, summary);
		for (const project of projects) {
			projectSet.add(project);
		}
	}

	const projects = [...projectSet].sort((a, b) => a.localeCompare(b));

	console.log(`\nProjects found: ${projects.length}`);
	for (const project of projects) {
		console.log(project);
	}

	const results: MigrationResult[] = [];
	if (options.execute && projects.length > 0) {
		for (const project of projects) {
			results.push(await runMigration(project));
		}
	} else if (!options.execute) {
		console.log(
			'\nDry run only. Re-run with --execute to migrate and delete legacy storage.',
		);
	}

	const successes = results.filter((result) => result.exitCode === 0).length;
	const failures = results.filter((result) => result.exitCode !== 0);

	console.log('\nSummary');
	console.log(`  Roots scanned: ${roots.length}`);
	console.log(`  Projects found: ${projects.length}`);
	console.log(`  Directories pruned: ${summary.prunedDirectories}`);
	console.log(`  Permission errors: ${summary.permissionErrors}`);
	console.log(`  Other scan errors: ${summary.scanErrors}`);
	console.log(`  Migrations succeeded: ${successes}`);
	console.log(`  Migrations failed: ${failures.length}`);

	if (failures.length > 0) {
		console.log('\nFailed projects:');
		for (const failure of failures) {
			console.log(`  ${failure.projectDir} (exit ${failure.exitCode})`);
		}
		process.exit(1);
	}
}

await main();
