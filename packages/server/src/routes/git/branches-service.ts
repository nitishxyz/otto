import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Context } from 'hono';
import { gitCheckoutBranchSchema, gitCreateBranchSchema } from './schemas.ts';
import { validateAndGetGitRoot } from './utils.ts';

const execFileAsync = promisify(execFile);

export type GitBranchListItem = {
	name: string;
	fullName: string;
	current: boolean;
	remote: boolean;
	remoteName?: string;
	upstream?: string;
	sha?: string;
	subject?: string;
};

function parseBranchLine(line: string): GitBranchListItem | null {
	// Format: <refname>\t<objectname>\t<upstream:short>\t<subject>
	const parts = line.split('\t');
	if (parts.length < 1) return null;

	const refname = parts[0];
	const sha = parts[1];
	const upstream = parts[2] || undefined;
	const subject = parts[3] || undefined;

	if (refname.startsWith('refs/heads/')) {
		const name = refname.slice('refs/heads/'.length);
		return {
			name,
			fullName: refname,
			current: false,
			remote: false,
			upstream,
			sha,
			subject,
		};
	}

	if (refname.startsWith('refs/remotes/')) {
		const stripped = refname.slice('refs/remotes/'.length);
		// Skip remote HEAD aliases
		if (stripped.endsWith('/HEAD')) return null;
		const slashIndex = stripped.indexOf('/');
		const remoteName = slashIndex === -1 ? '' : stripped.slice(0, slashIndex);
		const branchName =
			slashIndex === -1 ? stripped : stripped.slice(slashIndex + 1);
		return {
			name: branchName,
			fullName: refname,
			current: false,
			remote: true,
			remoteName,
			sha,
			subject,
		};
	}

	return null;
}

export async function handleListBranches(c: Context) {
	try {
		const project = c.req.query('project');
		const requestedPath = project || process.cwd();

		const validation = await validateAndGetGitRoot(requestedPath);
		if ('error' in validation) {
			return c.json(
				{ status: 'error', error: validation.error, code: validation.code },
				400,
			);
		}

		const { gitRoot } = validation;

		const { stdout } = await execFileAsync(
			'git',
			[
				'for-each-ref',
				'--format=%(refname)%09%(objectname:short)%09%(upstream:short)%09%(subject)',
				'refs/heads',
				'refs/remotes',
			],
			{ cwd: gitRoot, maxBuffer: 1024 * 1024 * 8 },
		);

		let current = '';
		try {
			const head = await execFileAsync(
				'git',
				['symbolic-ref', '--quiet', '--short', 'HEAD'],
				{ cwd: gitRoot },
			);
			current = head.stdout.trim();
		} catch {
			current = '';
		}

		const branches: GitBranchListItem[] = [];
		for (const line of stdout.split('\n')) {
			if (!line) continue;
			const parsed = parseBranchLine(line);
			if (!parsed) continue;
			if (!parsed.remote && parsed.name === current) parsed.current = true;
			branches.push(parsed);
		}

		// Sort: current first, then locals alphabetical, then remotes alphabetical
		branches.sort((a, b) => {
			if (a.current && !b.current) return -1;
			if (!a.current && b.current) return 1;
			if (a.remote !== b.remote) return a.remote ? 1 : -1;
			return a.name.localeCompare(b.name);
		});

		return c.json({
			status: 'ok',
			data: {
				current,
				branches,
			},
		});
	} catch (error) {
		return c.json(
			{
				status: 'error',
				error:
					error instanceof Error ? error.message : 'Failed to list branches',
			},
			500,
		);
	}
}

export async function handleCheckoutBranch(c: Context) {
	try {
		const body = await c.req.json().catch(() => ({}));
		const { project, branch } = gitCheckoutBranchSchema.parse(body);
		const requestedPath = project || process.cwd();

		const validation = await validateAndGetGitRoot(requestedPath);
		if ('error' in validation) {
			return c.json(
				{ status: 'error', error: validation.error, code: validation.code },
				400,
			);
		}

		const { gitRoot } = validation;

		await execFileAsync('git', ['checkout', branch], { cwd: gitRoot });

		return c.json({
			status: 'ok',
			data: { branch },
		});
	} catch (error) {
		const stderr =
			error && typeof error === 'object' && 'stderr' in error
				? String((error as { stderr?: unknown }).stderr ?? '')
				: '';
		const message =
			stderr.trim() ||
			(error instanceof Error ? error.message : 'Failed to checkout branch');
		return c.json({ status: 'error', error: message }, 500);
	}
}

export async function handleCreateBranch(c: Context) {
	try {
		const body = await c.req.json().catch(() => ({}));
		const { project, name, startPoint, checkout } =
			gitCreateBranchSchema.parse(body);
		const requestedPath = project || process.cwd();

		const validation = await validateAndGetGitRoot(requestedPath);
		if ('error' in validation) {
			return c.json(
				{ status: 'error', error: validation.error, code: validation.code },
				400,
			);
		}

		const { gitRoot } = validation;

		if (checkout) {
			const args = ['checkout', '-b', name];
			if (startPoint) args.push(startPoint);
			await execFileAsync('git', args, { cwd: gitRoot });
		} else {
			const args = ['branch', name];
			if (startPoint) args.push(startPoint);
			await execFileAsync('git', args, { cwd: gitRoot });
		}

		return c.json({
			status: 'ok',
			data: { branch: name, checkedOut: checkout ?? true },
		});
	} catch (error) {
		const stderr =
			error && typeof error === 'object' && 'stderr' in error
				? String((error as { stderr?: unknown }).stderr ?? '')
				: '';
		const message =
			stderr.trim() ||
			(error instanceof Error ? error.message : 'Failed to create branch');
		return c.json({ status: 'error', error: message }, 500);
	}
}
