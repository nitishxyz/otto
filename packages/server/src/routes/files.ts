import type { Hono } from 'hono';
import { openApiRoute } from '../openapi/route.ts';
import {
	handleFileTree,
	handleListFiles,
	handleRawFile,
	handleReadFile,
	handleSearchFiles,
} from './files/handlers.ts';

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
		handleListFiles,
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
		handleSearchFiles,
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
		handleFileTree,
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
		handleReadFile,
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
		handleRawFile,
	);
}
