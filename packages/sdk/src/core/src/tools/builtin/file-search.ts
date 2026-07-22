import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import fg from 'fast-glob';
import { createToolError, type ToolResponse } from '../error.ts';
import { defaultIgnoreGlobs } from './ignore.ts';

export type FileSearchResult = {
	count: number;
	total: number;
	files: string[];
	truncated: boolean;
};

function expandTilde(path: string): string {
	const home = process.env.HOME || process.env.USERPROFILE || '';
	if (!home) return path;
	if (path === '~') return home;
	if (path.startsWith('~/')) return `${home}/${path.slice(2)}`;
	return path;
}

/** Finds files by glob pattern for search's files mode. */
export async function searchFiles(args: {
	projectRoot: string;
	pattern: string;
	path?: string;
	ignore?: string[];
	limit?: number;
}): Promise<ToolResponse<FileSearchResult>> {
	const { projectRoot, pattern, path = '.', ignore, limit = 100 } = args;
	const scopedPath = expandTilde(String(path || '.')).trim();
	const isAbsolute =
		scopedPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(scopedPath);
	const searchPath = scopedPath
		? isAbsolute
			? scopedPath
			: join(projectRoot, scopedPath)
		: projectRoot;

	try {
		const files = await fg(pattern, {
			cwd: searchPath,
			ignore: defaultIgnoreGlobs(ignore),
			onlyFiles: true,
			absolute: false,
			dot: false,
		});
		const filesWithStats = await Promise.all(
			files.map(async (file) => {
				try {
					const stats = await stat(join(searchPath, file));
					return { file, mtime: stats.mtime.getTime() };
				} catch {
					return { file, mtime: 0 };
				}
			}),
		);
		filesWithStats.sort((a, b) => b.mtime - a.mtime);
		const limitedFiles = filesWithStats.slice(0, limit).map(({ file }) => file);
		return {
			ok: true,
			count: limitedFiles.length,
			total: files.length,
			files: limitedFiles,
			truncated: files.length > limit,
		};
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return createToolError(`File search failed: ${message}`, 'execution', {
			parameter: 'query',
			value: pattern,
			suggestion: 'Check if the glob pattern is valid',
		});
	}
}
