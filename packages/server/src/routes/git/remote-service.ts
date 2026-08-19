import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Context } from 'hono';
import { validateAndGetGitRoot } from './utils.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

const execFileAsync = promisify(execFile);

type GitRemote = { name: string; url: string; type: string };

function parseRemoteOutput(output: string): GitRemote[] {
	const remotes: GitRemote[] = [];
	const seen = new Set<string>();
	for (const line of output.trim().split('\n').filter(Boolean)) {
		const match = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/);
		if (!match) continue;
		const [, name, url, type] = match;
		const key = `${name}:${type}`;
		if (seen.has(key)) continue;
		seen.add(key);
		remotes.push({ name, url, type });
	}
	return remotes;
}

export async function handleGetGitRemotes(c: Context) {
	try {
		const requestedPath = await resolveRequestProjectRoot(c);

		const validation = await validateAndGetGitRoot(requestedPath);
		if ('error' in validation) {
			return c.json(
				{ status: 'error', error: validation.error, code: validation.code },
				400,
			);
		}

		const { stdout } = await execFileAsync('git', ['remote', '-v'], {
			cwd: validation.gitRoot,
		});

		return c.json({
			status: 'ok',
			data: { remotes: parseRemoteOutput(stdout) },
		});
	} catch (error) {
		return c.json(
			{
				status: 'error',
				error:
					error instanceof Error ? error.message : 'Failed to list remotes',
			},
			500,
		);
	}
}

export async function handleAddGitRemote(c: Context) {
	try {
		const { name, url } = c.req.valid('json' as never) as {
			name: string;
			url: string;
		};
		const requestedPath = await resolveRequestProjectRoot(c);

		const validation = await validateAndGetGitRoot(requestedPath);
		if ('error' in validation) {
			return c.json(
				{ status: 'error', error: validation.error, code: validation.code },
				400,
			);
		}

		await execFileAsync('git', ['remote', 'add', name, url], {
			cwd: validation.gitRoot,
		});

		return c.json({
			status: 'ok',
			data: { name, url },
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Failed to add remote';
		const status = message.includes('already exists') ? 400 : 500;
		return c.json({ status: 'error', error: message }, status);
	}
}

export async function handleRemoveGitRemote(c: Context) {
	try {
		const { name } = c.req.valid('json' as never) as { name: string };
		const requestedPath = await resolveRequestProjectRoot(c);

		const validation = await validateAndGetGitRoot(requestedPath);
		if ('error' in validation) {
			return c.json(
				{ status: 'error', error: validation.error, code: validation.code },
				400,
			);
		}

		await execFileAsync('git', ['remote', 'remove', name], {
			cwd: validation.gitRoot,
		});

		return c.json({
			status: 'ok',
			data: { removed: name },
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Failed to remove remote';
		return c.json({ status: 'error', error: message }, 500);
	}
}
