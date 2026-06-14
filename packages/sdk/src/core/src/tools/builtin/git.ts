import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import GIT_STATUS_DESCRIPTION from './git.status.txt' with { type: 'text' };
import GIT_DIFF_DESCRIPTION from './git.diff.txt' with { type: 'text' };
import GIT_COMMIT_DESCRIPTION from './git.commit.txt' with { type: 'text' };
import { createToolError, type ToolResponse } from '../error.ts';
import {
	appendCoAuthorTrailer,
	shouldCoAuthorCommits,
} from './git-identity.ts';

const execAsync = promisify(exec);

export function buildGitTools(
	projectRoot: string,
): Array<{ name: string; tool: Tool }> {
	// Helper to find git root directory
	async function findGitRoot(): Promise<string> {
		try {
			const { stdout } = await execAsync(
				`git -C "${projectRoot}" rev-parse --show-toplevel`,
			);
			return stdout.trim() || projectRoot;
		} catch {
			return projectRoot;
		}
	}

	async function inRepo(): Promise<boolean> {
		try {
			const { stdout } = await execAsync(
				`git -C "${projectRoot}" rev-parse --is-inside-work-tree`,
			);
			return stdout.trim() === 'true';
		} catch {
			return false;
		}
	}

	const git_status = tool({
		description: GIT_STATUS_DESCRIPTION,
		inputSchema: z.object({}),
		async execute(): Promise<
			ToolResponse<{ staged: number; unstaged: number; raw: string[] }>
		> {
			if (!(await inRepo())) {
				return createToolError('Not a git repository', 'not_found', {
					suggestion: 'Initialize a git repository with git init',
				});
			}
			const gitRoot = await findGitRoot();
			const { stdout } = await execAsync(
				`git -C "${gitRoot}" status --porcelain=v1`,
			);
			const lines = stdout.split('\n').filter(Boolean);
			let staged = 0;
			let unstaged = 0;
			for (const line of lines) {
				const x = line[0];
				const y = line[1];
				if (!x || !y) continue;
				if (x === '!' && y === '!') continue; // ignored files
				const isUntracked = x === '?' && y === '?';
				if (x !== ' ' && !isUntracked) staged += 1;
				if (isUntracked || y !== ' ') unstaged += 1;
			}
			return {
				ok: true,
				staged,
				unstaged,
				raw: lines.slice(0, 200),
			};
		},
	});

	const git_diff = tool({
		description: GIT_DIFF_DESCRIPTION,
		inputSchema: z.object({ all: z.boolean().optional().default(false) }),
		async execute({
			all,
		}: {
			all?: boolean;
		}): Promise<ToolResponse<{ all: boolean; patch: string }>> {
			if (!(await inRepo())) {
				return createToolError('Not a git repository', 'not_found', {
					suggestion: 'Initialize a git repository with git init',
				});
			}
			const gitRoot = await findGitRoot();
			// When all=true, show full working tree diff relative to HEAD
			// so both staged and unstaged changes are included. Otherwise,
			// show only the staged diff (index vs HEAD).
			const cmd = all
				? `git -C "${gitRoot}" diff HEAD`
				: `git -C "${gitRoot}" diff --staged`;
			const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
			const limited = stdout.split('\n').slice(0, 5000).join('\n');
			return { ok: true, all: !!all, patch: limited };
		},
	});

	const git_commit = tool({
		description: GIT_COMMIT_DESCRIPTION,
		inputSchema: z.object({
			message: z.string().min(5),
			amend: z.boolean().optional().default(false),
			signoff: z.boolean().optional().default(false),
		}),
		async execute({
			message,
			amend,
			signoff,
		}: {
			message: string;
			amend?: boolean;
			signoff?: boolean;
		}): Promise<ToolResponse<{ result: string }>> {
			if (!(await inRepo())) {
				return createToolError('Not a git repository', 'not_found', {
					suggestion: 'Initialize a git repository with git init',
				});
			}
			const gitRoot = await findGitRoot();
			const fullMessage = appendCoAuthorTrailer(
				message,
				shouldCoAuthorCommits(projectRoot),
			);
			const args = [
				'git',
				'-C',
				`"${gitRoot}"`,
				'commit',
				'-m',
				`"${fullMessage.replace(/"/g, '\\"')}"`,
			];
			if (amend) args.push('--amend');
			if (signoff) args.push('--signoff');
			try {
				const { stdout } = await execAsync(args.join(' '));
				return { ok: true, result: stdout.trim() };
			} catch (error: unknown) {
				const err = error as { stderr?: string; message?: string };
				const txt = err.stderr || err.message || 'git commit failed';
				return createToolError(txt, 'execution', {
					suggestion:
						'Check if there are staged changes and the commit message is valid',
				});
			}
		},
	});

	return [
		{ name: 'git_status', tool: git_status },
		{ name: 'git_diff', tool: git_diff },
		{ name: 'git_commit', tool: git_commit },
	];
}
