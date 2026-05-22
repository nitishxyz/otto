import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Context } from 'hono';
import {
	gitDeleteSchema,
	gitRestoreSchema,
	gitStageSchema,
	gitUnstageSchema,
} from './schemas.ts';
import { validateAndGetGitRoot } from './utils.ts';

const execFileAsync = promisify(execFile);

type StagingAction = 'stage' | 'unstage' | 'restore' | 'delete';

const actionConfig: Record<
	StagingAction,
	{
		schema: typeof gitStageSchema;
		command: (files: string[]) => string[];
		dataKey: 'staged' | 'unstaged' | 'restored' | 'deleted';
		fallbackError: string;
	}
> = {
	stage: {
		schema: gitStageSchema,
		command: (files) =>
			files.length === 1 && files[0] === '.'
				? ['add', '-A']
				: ['add', '--', ...files],
		dataKey: 'staged',
		fallbackError: 'Failed to stage files',
	},
	unstage: {
		schema: gitUnstageSchema,
		command: (files) => ['reset', 'HEAD', '--', ...files],
		dataKey: 'unstaged',
		fallbackError: 'Failed to unstage files',
	},
	restore: {
		schema: gitRestoreSchema,
		command: (files) => ['restore', '--', ...files],
		dataKey: 'restored',
		fallbackError: 'Failed to restore files',
	},
	delete: {
		schema: gitDeleteSchema,
		command: (files) => ['clean', '-f', '--', ...files],
		dataKey: 'deleted',
		fallbackError: 'Failed to delete files',
	},
};

async function handleStagingAction(c: Context, action: StagingAction) {
	const config = actionConfig[action];
	try {
		const body = await c.req.json();
		const { files, project } = config.schema.parse(body);
		const requestedPath = project || process.cwd();

		const validation = await validateAndGetGitRoot(requestedPath);
		if ('error' in validation) {
			return c.json(
				{ status: 'error', error: validation.error, code: validation.code },
				400,
			);
		}

		if (files.length === 0) {
			return c.json(
				{
					status: 'error',
					error: 'No files specified',
				},
				400,
			);
		}

		await execFileAsync('git', config.command(files), {
			cwd: validation.gitRoot,
		});

		return c.json({
			status: 'ok',
			data: {
				[config.dataKey]: files,
			},
		});
	} catch (error) {
		return c.json(
			{
				status: 'error',
				error: error instanceof Error ? error.message : config.fallbackError,
			},
			500,
		);
	}
}

export function handleStageFiles(c: Context) {
	return handleStagingAction(c, 'stage');
}

export function handleUnstageFiles(c: Context) {
	return handleStagingAction(c, 'unstage');
}

export function handleRestoreFiles(c: Context) {
	return handleStagingAction(c, 'restore');
}

export function handleDeleteFiles(c: Context) {
	return handleStagingAction(c, 'delete');
}
