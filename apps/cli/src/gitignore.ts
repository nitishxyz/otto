import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OTTO_IGNORE_ENTRY = '.otto';
const OTTO_IGNORE_PATTERNS = new Set(['.otto', '.otto/', '/.otto', '/.otto/']);

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

function hasOttoIgnoreEntry(content: string): boolean {
	return content
		.split(/\r?\n/)
		.some((line) => OTTO_IGNORE_PATTERNS.has(line.trim()));
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
 * Ensures the local otto workspace directory is ignored by git for a project.
 *
 * Returns true only when the repository .gitignore was changed. Non-git
 * directories and write failures are treated as no-ops so CLI startup is not
 * blocked by housekeeping.
 */
export async function ensureProjectOttoIgnored(
	projectRoot: string,
): Promise<boolean> {
	try {
		const gitRoot = await getGitRoot(projectRoot);
		if (!gitRoot) return false;

		const gitignorePath = join(gitRoot, '.gitignore');
		const content = await readGitignore(gitignorePath);
		if (hasOttoIgnoreEntry(content)) return false;

		const separator =
			content.length === 0 || content.endsWith('\n') ? '' : '\n';
		await writeFile(
			gitignorePath,
			`${content}${separator}${OTTO_IGNORE_ENTRY}\n`,
			'utf8',
		);
		return true;
	} catch {
		return false;
	}
}
