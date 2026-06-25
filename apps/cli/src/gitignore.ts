import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OTTO_IGNORE_PATTERNS = new Set(['.otto', '.otto/', '/.otto', '/.otto/']);
const OLD_ROOT_RUNTIME_PATTERNS = new Set([
	'.otto/otto.sqlite*',
	'.otto/attachments/',
	'.otto/debug/',
	'.otto/debug-dumps/',
	'.otto/logs/',
	'.otto/tmp/',
	'.otto/cache/',
	'.otto/artifacts/',
	'.otto/*.local.json',
]);
const NESTED_ROOT_RUNTIME_PATTERNS = new Set([
	'**/.otto/otto.sqlite*',
	'**/.otto/attachments/',
	'**/.otto/debug/',
	'**/.otto/debug-dumps/',
	'**/.otto/logs/',
	'**/.otto/tmp/',
	'**/.otto/cache/',
	'**/.otto/artifacts/',
	'**/.otto/*.local.json',
]);

async function getGitRoot(projectRoot: string): Promise<string | null> {
	try {
		const proc = Bun.spawn(['git', 'rev-parse', '--show-toplevel'], {
			cwd: projectRoot,
			stderr: 'pipe',
			stdout: 'pipe',
		});
		const stdout = await new Response(proc.stdout).text();
		await new Response(proc.stderr).text();
		const exitCode = await proc.exited;
		if (exitCode !== 0) return null;
		const root = stdout.trim();
		return root.length > 0 ? root : null;
	} catch {
		return null;
	}
}

function updateRootGitignore(content: string): string | null {
	let removedOttoRuntimeEntry = false;
	const lines = content.split(/\r?\n/);
	const nextLines = lines.filter((line) => {
		const trimmed = line.trim();
		if (
			OTTO_IGNORE_PATTERNS.has(trimmed) ||
			OLD_ROOT_RUNTIME_PATTERNS.has(trimmed) ||
			NESTED_ROOT_RUNTIME_PATTERNS.has(trimmed)
		) {
			removedOttoRuntimeEntry = true;
			return false;
		}
		return true;
	});

	while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
		nextLines.pop();
	}
	if (!removedOttoRuntimeEntry) return null;
	return [...nextLines, ''].join('\n');
}

async function readGitignore(path: string): Promise<string> {
	try {
		return await readFile(path, 'utf8');
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return '';
		}
		throw error;
	}
}

/**
 * Removes stale blanket/runtime `.otto` ignores from the root gitignore.
 *
 * Returns true when the repository .gitignore was changed. Non-git directories
 * and write failures are treated as no-ops so CLI startup is not blocked by
 * housekeeping.
 */
export async function ensureProjectOttoIgnored(
	projectRoot: string,
): Promise<boolean> {
	try {
		const gitRoot = await getGitRoot(projectRoot);
		if (!gitRoot) return false;

		const gitignorePath = join(gitRoot, '.gitignore');
		const content = await readGitignore(gitignorePath);
		const updatedRootGitignore = updateRootGitignore(content);
		if (updatedRootGitignore !== null && updatedRootGitignore !== content) {
			await writeFile(gitignorePath, updatedRootGitignore, 'utf8');
			return true;
		}

		return false;
	} catch {
		return false;
	}
}
