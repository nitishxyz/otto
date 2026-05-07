import type { Hono } from 'hono';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { serializeError } from '../runtime/errors/api-error.ts';
import { logger } from '@ottocode/sdk';
import { openApiRoute } from '../openapi/route.ts';
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
} from './files/service.ts';

export function registerFilesRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/files',
			tags: ['files'],
			operationId: 'listFiles',
			summary: 'List project files',
			description:
				'Returns list of files in the project directory, excluding common build artifacts and dependencies',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
				{
					in: 'query',
					name: 'maxDepth',
					required: false,
					schema: {
						type: 'integer',
						default: 10,
					},
					description: 'Maximum directory depth to traverse',
				},
				{
					in: 'query',
					name: 'limit',
					required: false,
					schema: {
						type: 'integer',
						default: 1000,
					},
					description: 'Maximum number of files to return',
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									files: {
										type: 'array',
										items: {
											type: 'string',
										},
									},
									changedFiles: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												path: {
													type: 'string',
												},
												status: {
													type: 'string',
													enum: [
														'added',
														'modified',
														'deleted',
														'renamed',
														'untracked',
													],
												},
											},
											required: ['path', 'status'],
										},
										description:
											'List of files with uncommitted changes (from git status)',
									},
									truncated: {
										type: 'boolean',
									},
								},
								required: ['files', 'changedFiles', 'truncated'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const policy = getSearchPolicy(projectRoot);
				const maxDepth = clampNumber(
					Number.parseInt(
						c.req.query('maxDepth') || String(policy.maxDepth),
						10,
					),
					1,
					policy.maxDepth,
				);
				const limit = clampNumber(
					Number.parseInt(c.req.query('limit') || String(policy.limit), 10),
					1,
					policy.limit,
				);

				let result = await listFilesWithRg(
					projectRoot,
					maxDepth,
					limit,
					policy.includeIgnored,
				);

				if (result.files.length === 0) {
					const gitignorePatterns = await parseGitignore(projectRoot);
					result = await traverseDirectory(
						projectRoot,
						projectRoot,
						maxDepth,
						0,
						limit,
						[],
						gitignorePatterns,
					);
				}

				const [changedFiles, ignoredFiles] = await Promise.all([
					getChangedFiles(projectRoot),
					getGitIgnoredFiles(projectRoot, result.files),
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

				return c.json({
					files: result.files,
					ignoredFiles: Array.from(ignoredFiles),
					changedFiles: Array.from(changedFiles.entries()).map(
						([path, status]) => ({
							path,
							status,
						}),
					),
					truncated: result.truncated,
					policy: {
						maxDepth,
						limit,
						home: isHomeDirectory(projectRoot),
					},
				});
			} catch (err) {
				logger.error('Files route error:', err);
				return c.json({ error: serializeError(err) }, 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/files/search',
			tags: ['files'],
			operationId: 'searchFiles',
			summary: 'Search project files',
			description:
				'Searches files for mentions and quick-open. Excludes dependencies, build artifacts, and gitignored files by default.',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
				{
					in: 'query',
					name: 'q',
					required: false,
					schema: {
						type: 'string',
						default: '',
					},
					description: 'Search query',
				},
				{
					in: 'query',
					name: 'maxDepth',
					required: false,
					schema: {
						type: 'integer',
					},
					description: 'Maximum directory depth to traverse',
				},
				{
					in: 'query',
					name: 'limit',
					required: false,
					schema: {
						type: 'integer',
					},
					description: 'Maximum number of files to return',
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									files: {
										type: 'array',
										items: {
											type: 'string',
										},
									},
									changedFiles: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												path: {
													type: 'string',
												},
												status: {
													type: 'string',
												},
											},
											required: ['path', 'status'],
										},
									},
									truncated: {
										type: 'boolean',
									},
								},
								required: ['files', 'changedFiles', 'truncated'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const query = c.req.query('q') || '';
				const policy = getSearchPolicy(projectRoot);
				const maxDepth = clampNumber(
					Number.parseInt(
						c.req.query('maxDepth') || String(policy.maxDepth),
						10,
					),
					1,
					policy.maxDepth,
				);
				const limit = clampNumber(
					Number.parseInt(c.req.query('limit') || String(policy.limit), 10),
					1,
					policy.limit,
				);

				let result = await listFilesWithRg(
					projectRoot,
					maxDepth,
					limit,
					policy.includeIgnored,
					query,
				);

				if (result.files.length === 0) {
					const gitignorePatterns = await parseGitignore(projectRoot);
					result = await traverseDirectory(
						projectRoot,
						projectRoot,
						maxDepth,
						0,
						limit,
						[],
						gitignorePatterns,
					);
					const normalizedQuery = query.trim().toLowerCase();
					if (normalizedQuery) {
						const files = result.files.filter((file) =>
							file.toLowerCase().includes(normalizedQuery),
						);
						result = {
							files: files.slice(0, limit),
							truncated: files.length > limit,
						};
					}
				}

				const [changedFiles, ignoredFiles] = await Promise.all([
					getChangedFiles(projectRoot),
					getGitIgnoredFiles(projectRoot, result.files),
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

				return c.json({
					files: result.files,
					ignoredFiles: Array.from(ignoredFiles),
					changedFiles: Array.from(changedFiles.entries()).map(
						([path, status]) => ({
							path,
							status,
						}),
					),
					truncated: result.truncated,
					policy: {
						maxDepth,
						limit,
						home: isHomeDirectory(projectRoot),
					},
				});
			} catch (err) {
				logger.error('Files search route error:', err);
				return c.json({ error: serializeError(err) }, 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/files/tree',
			tags: ['files'],
			operationId: 'getFileTree',
			summary: 'Get directory tree listing',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
				{
					in: 'query',
					name: 'path',
					required: false,
					schema: {
						type: 'string',
						default: '.',
					},
					description: 'Directory path relative to project root',
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									items: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												name: {
													type: 'string',
												},
												path: {
													type: 'string',
												},
												type: {
													type: 'string',
													enum: ['file', 'directory'],
												},
												gitignored: {
													type: 'boolean',
												},
												vendor: {
													type: 'boolean',
												},
												searchable: {
													type: 'boolean',
												},
											},
											required: ['name', 'path', 'type'],
										},
									},
									path: {
										type: 'string',
									},
									truncated: {
										type: 'boolean',
									},
								},
								required: ['items', 'path', 'truncated'],
							},
						},
					},
				},
			},
		},
		async (c) => {
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
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/files/read',
			tags: ['files'],
			operationId: 'readFile',
			summary: 'Read file content',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
				{
					in: 'query',
					name: 'path',
					required: true,
					schema: {
						type: 'string',
					},
					description: 'File path relative to project root',
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									content: {
										type: 'string',
									},
									path: {
										type: 'string',
									},
									extension: {
										type: 'string',
									},
									lineCount: {
										type: 'integer',
									},
								},
								required: ['content', 'path', 'extension', 'lineCount'],
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const filePath = c.req.query('path');

				if (!filePath) {
					return c.json(
						{ error: 'Missing required query parameter: path' },
						400,
					);
				}

				const absPath = join(projectRoot, filePath);
				if (!absPath.startsWith(projectRoot)) {
					return c.json({ error: 'Path traversal not allowed' }, 403);
				}

				const content = await readFile(absPath, 'utf-8');
				const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
				const lineCount = content.split('\n').length;

				return c.json({ content, path: filePath, extension, lineCount });
			} catch (err) {
				logger.error('Files read route error:', err);
				return c.json({ error: serializeError(err) }, 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/files/raw',
			tags: ['files'],
			operationId: 'getFileRaw',
			summary: 'Read raw file bytes',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: { type: 'string' },
					description:
						'Project root override (defaults to current working directory).',
				},
				{
					in: 'query',
					name: 'path',
					required: true,
					schema: { type: 'string' },
					description: 'Relative file path to read.',
				},
			],
			responses: {
				'200': {
					description: 'Raw file content',
					content: {
						'application/octet-stream': {
							schema: { type: 'string', format: 'binary' },
						},
					},
				},
				'400': { description: 'Missing path parameter' },
				'403': { description: 'Path traversal not allowed' },
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const filePath = c.req.query('path');

				if (!filePath) {
					return c.json(
						{ error: 'Missing required query parameter: path' },
						400,
					);
				}

				const absPath = join(projectRoot, filePath);
				if (!absPath.startsWith(projectRoot)) {
					return c.json({ error: 'Path traversal not allowed' }, 403);
				}

				const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
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

				const data = await readFile(absPath);
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
		},
	);
}
