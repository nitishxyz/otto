import { logger } from '@ottocode/sdk';
import type { Context } from 'hono';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	TREE_ENTRY_LIMIT,
	clampNumber,
	getChangedFiles,
	getGitIgnoredFiles,
	getSearchPolicy,
	isHomeDirectory,
	listFilesWithRg,
	matchesGitignorePattern,
	parseGitignore,
	shouldExcludeDir,
	shouldExcludeFile,
	traverseDirectory,
} from './service.ts';

async function getSortedFileResult(args: {
	projectRoot: string;
	maxDepth: number;
	limit: number;
	query?: string;
}) {
	const policy = getSearchPolicy(args.projectRoot);
	let result = await listFilesWithRg(
		args.projectRoot,
		args.maxDepth,
		args.limit,
		policy.includeIgnored,
		args.query,
	);

	if (result.files.length === 0) {
		const gitignorePatterns = await parseGitignore(args.projectRoot);
		result = await traverseDirectory(
			args.projectRoot,
			args.projectRoot,
			args.maxDepth,
			0,
			args.limit,
			[],
			gitignorePatterns,
		);
		const normalizedQuery = args.query?.trim().toLowerCase();
		if (normalizedQuery) {
			const files = result.files.filter((file) =>
				file.toLowerCase().includes(normalizedQuery),
			);
			result = {
				files: files.slice(0, args.limit),
				truncated: files.length > args.limit,
			};
		}
	}

	const [changedFiles, ignoredFiles] = await Promise.all([
		getChangedFiles(args.projectRoot),
		getGitIgnoredFiles(args.projectRoot, result.files),
	]);

	result.files.sort((a, b) => {
		const aIgnored = ignoredFiles.has(a);
		const bIgnored = ignoredFiles.has(b);
		if (aIgnored !== bIgnored) return aIgnored ? 1 : -1;
		const aChanged = changedFiles.has(a);
		const bChanged = changedFiles.has(b);
		if (aChanged && !bChanged) return -1;
		if (!aChanged && bChanged) return 1;
		return a.localeCompare(b);
	});

	return { result, changedFiles, ignoredFiles };
}

function getFilePolicyFromQuery(c: Context) {
	const projectRoot = c.req.query('project') || process.cwd();
	const policy = getSearchPolicy(projectRoot);
	const maxDepth = clampNumber(
		Number.parseInt(c.req.query('maxDepth') || String(policy.maxDepth), 10),
		1,
		policy.maxDepth,
	);
	const limit = clampNumber(
		Number.parseInt(c.req.query('limit') || String(policy.limit), 10),
		1,
		policy.limit,
	);
	return { projectRoot, maxDepth, limit };
}

function fileListResponse(args: {
	projectRoot: string;
	maxDepth: number;
	limit: number;
	result: { files: string[]; truncated: boolean };
	changedFiles: Map<string, string>;
	ignoredFiles: Set<string>;
}) {
	return {
		files: args.result.files,
		ignoredFiles: Array.from(args.ignoredFiles),
		changedFiles: Array.from(args.changedFiles.entries()).map(
			([path, status]) => ({
				path,
				status,
			}),
		),
		truncated: args.result.truncated,
		policy: {
			maxDepth: args.maxDepth,
			limit: args.limit,
			home: isHomeDirectory(args.projectRoot),
		},
	};
}

export async function handleListFiles(c: Context) {
	try {
		const { projectRoot, maxDepth, limit } = getFilePolicyFromQuery(c);
		const { result, changedFiles, ignoredFiles } = await getSortedFileResult({
			projectRoot,
			maxDepth,
			limit,
		});
		return c.json(
			fileListResponse({
				projectRoot,
				maxDepth,
				limit,
				result,
				changedFiles,
				ignoredFiles,
			}),
		);
	} catch (err) {
		logger.error('Files route error:', err);
		return c.json({ error: serializeError(err) }, 500);
	}
}

export async function handleSearchFiles(c: Context) {
	try {
		const { projectRoot, maxDepth, limit } = getFilePolicyFromQuery(c);
		const query = c.req.query('q') || '';
		const { result, changedFiles, ignoredFiles } = await getSortedFileResult({
			projectRoot,
			maxDepth,
			limit,
			query,
		});
		return c.json(
			fileListResponse({
				projectRoot,
				maxDepth,
				limit,
				result,
				changedFiles,
				ignoredFiles,
			}),
		);
	} catch (err) {
		logger.error('Files search route error:', err);
		return c.json({ error: serializeError(err) }, 500);
	}
}

export async function handleFileTree(c: Context) {
	try {
		const projectRoot = c.req.query('project') || process.cwd();
		const dirPath = c.req.query('path') || '.';
		const targetDir = resolve(projectRoot, dirPath);
		if (!targetDir.startsWith(resolve(projectRoot))) {
			return c.json({ error: 'Path traversal not allowed' }, 403);
		}

		const gitignorePatterns = await parseGitignore(projectRoot);
		const entries = await readdir(targetDir, { withFileTypes: true });
		const truncated = entries.length > TREE_ENTRY_LIMIT;
		const items: Array<{
			name: string;
			path: string;
			type: 'file' | 'directory';
			gitignored?: boolean;
			vendor?: boolean;
			searchable?: boolean;
		}> = [];

		for (const entry of entries.slice(0, TREE_ENTRY_LIMIT)) {
			const relPath = relative(projectRoot, join(targetDir, entry.name));
			if (entry.isDirectory()) {
				const ignored = matchesGitignorePattern(relPath, gitignorePatterns);
				const vendor = shouldExcludeDir(entry.name);
				items.push({
					name: entry.name,
					path: relPath,
					type: 'directory',
					gitignored: ignored || undefined,
					vendor: vendor || undefined,
					searchable: vendor || ignored ? false : undefined,
				});
			} else if (entry.isFile()) {
				if (shouldExcludeFile(entry.name)) continue;
				const ignored = matchesGitignorePattern(relPath, gitignorePatterns);
				items.push({
					name: entry.name,
					path: relPath,
					type: 'file',
					gitignored: ignored || undefined,
					searchable: ignored ? false : undefined,
				});
			}
		}

		items.sort((a, b) => {
			if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
			const aIgnored = a.gitignored ?? false;
			const bIgnored = b.gitignored ?? false;
			if (aIgnored !== bIgnored) return aIgnored ? 1 : -1;
			return a.name.localeCompare(b.name);
		});

		return c.json({ items, path: dirPath, truncated });
	} catch (err) {
		logger.error('Files tree route error:', err);
		return c.json({ error: serializeError(err) }, 500);
	}
}

function getSafeFilePath(c: Context) {
	const projectRoot = c.req.query('project') || process.cwd();
	const filePath = c.req.query('path');
	if (!filePath) {
		return { error: 'Missing required query parameter: path' as const };
	}
	const absPath = join(projectRoot, filePath);
	if (!absPath.startsWith(projectRoot)) {
		return {
			error: 'Path traversal not allowed' as const,
			status: 403 as const,
		};
	}
	return { projectRoot, filePath, absPath };
}

export async function handleReadFile(c: Context) {
	try {
		const target = getSafeFilePath(c);
		if ('error' in target)
			return c.json({ error: target.error }, target.status ?? 400);
		const content = await readFile(target.absPath, 'utf-8');
		const extension = target.filePath.split('.').pop()?.toLowerCase() ?? '';
		const lineCount = content.split('\n').length;
		return c.json({
			content,
			path: target.filePath,
			extension,
			lineCount,
		});
	} catch (err) {
		logger.error('Files read route error:', err);
		return c.json({ error: serializeError(err) }, 500);
	}
}

export async function handleRawFile(c: Context) {
	try {
		const target = getSafeFilePath(c);
		if ('error' in target)
			return c.json({ error: target.error }, target.status ?? 400);
		const ext = target.filePath.split('.').pop()?.toLowerCase() ?? '';
		const mimeTypes: Record<string, string> = {
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			svg: 'image/svg+xml',
			webp: 'image/webp',
			ico: 'image/x-icon',
			bmp: 'image/bmp',
			avif: 'image/avif',
		};
		const contentType = mimeTypes[ext] || 'application/octet-stream';
		const data = await readFile(target.absPath);
		return new Response(data, {
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'no-cache',
			},
		});
	} catch (err) {
		logger.error('Files raw route error:', err);
		return c.json({ error: serializeError(err) }, 500);
	}
}
