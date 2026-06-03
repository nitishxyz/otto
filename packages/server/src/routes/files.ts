import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import {
	handleFileTree,
	handleListFiles,
	handleRawFile,
	handleReadFile,
	handleSearchFiles,
} from './files/handlers.ts';

const projectQueryPart = {
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
};

const listFilesQuerySchema = z.object({
	...projectQueryPart,
	maxDepth: z.coerce
		.number()
		.int()
		.optional()
		.default(10)
		.openapi({
			param: { name: 'maxDepth', in: 'query' },
			description: 'Maximum directory depth to traverse',
		}),
	limit: z.coerce
		.number()
		.int()
		.optional()
		.default(1000)
		.openapi({
			param: { name: 'limit', in: 'query' },
			description: 'Maximum number of files to return',
		}),
});

const searchFilesQuerySchema = z.object({
	...projectQueryPart,
	q: z
		.string()
		.optional()
		.default('')
		.openapi({
			param: { name: 'q', in: 'query' },
			description: 'Search query',
		}),
	maxDepth: z.coerce
		.number()
		.int()
		.optional()
		.openapi({
			param: { name: 'maxDepth', in: 'query' },
			description: 'Maximum directory depth to traverse',
		}),
	limit: z.coerce
		.number()
		.int()
		.optional()
		.openapi({
			param: { name: 'limit', in: 'query' },
			description: 'Maximum number of files to return',
		}),
});

const treeQuerySchema = z.object({
	...projectQueryPart,
	path: z
		.string()
		.optional()
		.default('.')
		.openapi({
			param: { name: 'path', in: 'query' },
			description: 'Directory path relative to project root',
		}),
});

const filePathQuerySchema = z.object({
	...projectQueryPart,
	path: z.string().openapi({
		param: { name: 'path', in: 'query' },
		description: 'Absolute file path or path relative to project root',
	}),
});

const changedFileSchema = z.object({
	path: z.string(),
	status: z.string(),
});

const fileListResponseSchema = z.object({
	files: z.array(z.string()),
	changedFiles: z.array(changedFileSchema),
	truncated: z.boolean(),
});

const treeItemSchema = z.object({
	name: z.string(),
	path: z.string(),
	type: z.enum(['file', 'directory']),
	gitignored: z.boolean().optional(),
	vendor: z.boolean().optional(),
	searchable: z.boolean().optional(),
});

const fileTreeResponseSchema = z.object({
	items: z.array(treeItemSchema),
	path: z.string(),
	truncated: z.boolean(),
});

const readFileResponseSchema = z.object({
	content: z.string(),
	path: z.string(),
	extension: z.string(),
	lineCount: z.number().int(),
});

const fileErrorSchema = z.object({
	error: z.string(),
});

export function registerFilesRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/files',
			tags: ['files'],
			operationId: 'listFiles',
			summary: 'List project files',
			description:
				'Returns list of files in the project directory, excluding common build artifacts and dependencies',
			request: { query: listFilesQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: fileListResponseSchema },
					},
				},
			},
		},
		handleListFiles,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/files/search',
			tags: ['files'],
			operationId: 'searchFiles',
			summary: 'Search project files',
			description:
				'Searches files for mentions and quick-open. Excludes dependencies, build artifacts, and gitignored files by default.',
			request: { query: searchFilesQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: fileListResponseSchema },
					},
				},
			},
		},
		handleSearchFiles,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/files/tree',
			tags: ['files'],
			operationId: 'getFileTree',
			summary: 'Get directory tree listing',
			request: { query: treeQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: fileTreeResponseSchema },
					},
				},
			},
		},
		handleFileTree,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/files/read',
			tags: ['files'],
			operationId: 'readFile',
			summary: 'Read file content',
			request: { query: filePathQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: readFileResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: fileErrorSchema },
					},
				},
			},
		},
		handleReadFile,
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/files/raw',
			tags: ['files'],
			operationId: 'getFileRaw',
			summary: 'Read raw file bytes',
			request: { query: filePathQuerySchema },
			responses: {
				'200': {
					description: 'Raw file content',
					content: {
						'application/octet-stream': {
							schema: z.string().openapi({ format: 'binary' }),
						},
					},
				},
				'400': { description: 'Missing path parameter' },
				'403': { description: 'Path traversal not allowed' },
			},
		},
		handleRawFile,
	);
}
