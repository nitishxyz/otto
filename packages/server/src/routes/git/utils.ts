import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { GitFile, GitRoot, GitError, GitOperationState } from './types.ts';

const execFileAsync = promisify(execFile);

const LANGUAGE_MAP: Record<string, string> = {
	js: 'javascript',
	jsx: 'jsx',
	ts: 'typescript',
	tsx: 'tsx',
	py: 'python',
	rb: 'ruby',
	go: 'go',
	rs: 'rust',
	java: 'java',
	c: 'c',
	cpp: 'cpp',
	h: 'c',
	hpp: 'cpp',
	cs: 'csharp',
	php: 'php',
	sh: 'bash',
	bash: 'bash',
	zsh: 'bash',
	sql: 'sql',
	json: 'json',
	yaml: 'yaml',
	yml: 'yaml',
	xml: 'xml',
	html: 'html',
	css: 'css',
	scss: 'scss',
	md: 'markdown',
	txt: 'plaintext',
	svelte: 'svelte',
};

export function inferLanguage(filePath: string): string {
	const extension = extname(filePath).toLowerCase().replace('.', '');
	if (!extension) {
		return 'plaintext';
	}
	return LANGUAGE_MAP[extension] ?? 'plaintext';
}

export function summarizeDiff(diff: string): {
	insertions: number;
	deletions: number;
	binary: boolean;
} {
	let insertions = 0;
	let deletions = 0;
	let binary = false;

	for (const line of diff.split('\n')) {
		if (line.startsWith('Binary files ') || line.includes('GIT binary patch')) {
			binary = true;
			break;
		}

		if (line.startsWith('+') && !line.startsWith('+++')) {
			insertions++;
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			deletions++;
		}
	}

	return { insertions, deletions, binary };
}

export async function validateAndGetGitRoot(
	requestedPath: string,
): Promise<GitRoot | GitError> {
	try {
		const { stdout: gitRoot } = await execFileAsync(
			'git',
			['rev-parse', '--show-toplevel'],
			{
				cwd: requestedPath,
			},
		);
		return { gitRoot: gitRoot.trim() };
	} catch {
		return {
			error: 'Not a git repository',
			code: 'NOT_A_GIT_REPO',
		};
	}
}

export async function checkIfNewFile(
	gitRoot: string,
	file: string,
): Promise<boolean> {
	try {
		await execFileAsync('git', ['ls-files', '--error-unmatch', file], {
			cwd: gitRoot,
		});
		return false;
	} catch {
		return true;
	}
}

function getStatusFromCodeV2(code: string): GitFile['status'] {
	switch (code) {
		case 'M':
			return 'modified';
		case 'A':
			return 'added';
		case 'D':
			return 'deleted';
		case 'R':
			return 'renamed';
		case 'C':
			return 'modified';
		default:
			return 'modified';
	}
}

function getConflictType(xy: string): GitFile['conflictType'] {
	switch (xy) {
		case 'UU':
			return 'both-modified';
		case 'AA':
			return 'both-added';
		case 'DD':
			return 'both-deleted';
		case 'DU':
		case 'UD':
			return 'deleted-by-us';
		case 'AU':
		case 'UA':
			return 'deleted-by-them';
		default:
			return 'both-modified';
	}
}

export function parseGitStatus(
	statusOutput: string,
	gitRoot: string,
): {
	staged: GitFile[];
	unstaged: GitFile[];
	untracked: GitFile[];
	conflicted: GitFile[];
} {
	const lines = statusOutput.trim().split('\n').filter(Boolean);
	const staged: GitFile[] = [];
	const unstaged: GitFile[] = [];
	const untracked: GitFile[] = [];
	const conflicted: GitFile[] = [];

	for (const line of lines) {
		if (line.startsWith('1 ') || line.startsWith('2 ')) {
			const parts = line.split(' ');
			if (parts.length < 9) continue;

			const xy = parts[1];
			const x = xy[0];
			const y = xy[1];
			const pathStartIndex = line.startsWith('2 ') ? 9 : 8;
			const rawPath = parts.slice(pathStartIndex).join(' ');
			const [path, oldPath] = rawPath.split('\t');
			const absPath = join(gitRoot, path);

			if (x !== '.') {
				staged.push({
					path,
					absPath,
					status: getStatusFromCodeV2(x),
					staged: true,
					isNew: x === 'A',
					oldPath,
				});
			}

			if (y !== '.') {
				unstaged.push({
					path,
					absPath,
					status: getStatusFromCodeV2(y),
					staged: false,
					isNew: false,
					oldPath,
				});
			}
		} else if (line.startsWith('? ')) {
			const path = line.slice(2);
			const absPath = join(gitRoot, path);
			untracked.push({
				path,
				absPath,
				status: 'untracked',
				staged: false,
				isNew: true,
			});
		} else if (line.startsWith('u ')) {
			const parts = line.split(' ');
			if (parts.length < 11) continue;

			const xy = parts[1];
			const path = parts.slice(10).join(' ');
			const absPath = join(gitRoot, path);

			conflicted.push({
				path,
				absPath,
				status: 'conflicted',
				staged: false,
				isNew: false,
				conflictType: getConflictType(xy),
			});
		}
	}

	return { staged, unstaged, untracked, conflicted };
}

export async function getAheadBehind(
	gitRoot: string,
): Promise<{ ahead: number; behind: number }> {
	try {
		const { stdout } = await execFileAsync(
			'git',
			['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
			{ cwd: gitRoot },
		);
		const [ahead, behind] = stdout.trim().split(/\s+/).map(Number);
		return { ahead: ahead || 0, behind: behind || 0 };
	} catch {
		return { ahead: 0, behind: 0 };
	}
}

export async function getCurrentBranch(gitRoot: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync(
			'git',
			['branch', '--show-current'],
			{
				cwd: gitRoot,
			},
		);
		return stdout.trim();
	} catch {
		return 'unknown';
	}
}

export async function getHeadInfo(gitRoot: string): Promise<{
	branch: string;
	headSha: string;
	shortHeadSha: string;
	isDetached: boolean;
}> {
	const [branchResult, headResult, shortHeadResult] = await Promise.allSettled([
		execFileAsync('git', ['branch', '--show-current'], { cwd: gitRoot }),
		execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: gitRoot }),
		execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: gitRoot }),
	]);

	const branch =
		branchResult.status === 'fulfilled' ? branchResult.value.stdout.trim() : '';
	const headSha =
		headResult.status === 'fulfilled' ? headResult.value.stdout.trim() : '';
	const shortHeadSha =
		shortHeadResult.status === 'fulfilled'
			? shortHeadResult.value.stdout.trim()
			: headSha.slice(0, 7);

	return {
		branch: branch || 'HEAD',
		headSha,
		shortHeadSha,
		isDetached: !branch,
	};
}

async function getGitDir(gitRoot: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync('git', ['rev-parse', '--git-dir'], {
			cwd: gitRoot,
		});
		const gitDir = stdout.trim();
		return isAbsolute(gitDir) ? gitDir : join(gitRoot, gitDir);
	} catch {
		return null;
	}
}

function readGitStateFile(dir: string, file: string): string | undefined {
	const path = join(dir, file);
	if (!existsSync(path)) return undefined;
	return readFileSync(path, 'utf8').trim() || undefined;
}

function readRebaseState(
	gitDir: string,
	dirName: 'rebase-merge' | 'rebase-apply',
): GitOperationState | null {
	const rebaseDir = join(gitDir, dirName);
	if (!existsSync(rebaseDir)) return null;

	const current = Number(readGitStateFile(rebaseDir, 'msgnum')) || undefined;
	const total = Number(readGitStateFile(rebaseDir, 'end')) || undefined;
	const isInteractive = existsSync(join(rebaseDir, 'interactive'));

	return {
		type: isInteractive ? 'rebase-interactive' : 'rebase',
		label: isInteractive ? 'Interactive rebase' : 'Rebase',
		current,
		total,
		headName: readGitStateFile(rebaseDir, 'head-name'),
		onto: readGitStateFile(rebaseDir, 'onto'),
	};
}

export async function getGitOperationState(
	gitRoot: string,
): Promise<GitOperationState | null> {
	const gitDir = await getGitDir(gitRoot);
	if (!gitDir) return null;

	const rebaseState =
		readRebaseState(gitDir, 'rebase-merge') ??
		readRebaseState(gitDir, 'rebase-apply');
	if (rebaseState) return rebaseState;

	if (existsSync(join(gitDir, 'MERGE_HEAD'))) {
		return { type: 'merge', label: 'Merge' };
	}
	if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) {
		return { type: 'cherry-pick', label: 'Cherry-pick' };
	}
	if (existsSync(join(gitDir, 'REVERT_HEAD'))) {
		return { type: 'revert', label: 'Revert' };
	}
	if (existsSync(join(gitDir, 'BISECT_LOG'))) {
		return { type: 'bisect', label: 'Bisect' };
	}

	return null;
}
