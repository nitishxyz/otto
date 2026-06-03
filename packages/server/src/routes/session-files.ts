import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { loadConfig } from '@ottocode/sdk';
import { getDb } from '@ottocode/database';
import { messages, messageParts, sessions } from '@ottocode/database/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { serializeError } from '../runtime/errors/api-error.ts';
import { logger } from '@ottocode/sdk';
import { zodOpenApiRoute } from '../openapi/route.ts';

const FILE_EDIT_TOOLS = [
	'Write',
	'Edit',
	'MultiEdit',
	'CopyInto',
	'ApplyPatch',
	'write',
	'edit',
	'multiedit',
	'copy_into',
	'apply_patch',
];

interface FileOperation {
	path: string;
	operation: 'write' | 'patch' | 'create';
	timestamp: number;
	toolCallId: string;
	toolName: string;
	patch?: string;
	content?: string;
	artifact?: {
		kind: string;
		patch?: string;
		summary?: { additions: number; deletions: number };
	};
}

interface SessionFile {
	path: string;
	operations: FileOperation[];
	operationCount: number;
	firstModified: number;
	lastModified: number;
}

interface ToolResultData {
	path?: string;
	targetPath?: string;
	args?: Record<string, unknown>;
	files?: Array<string | { path: string }>;
	result?: {
		ok?: boolean;
		artifact?: {
			kind?: string;
			patch?: string;
			summary?: { additions?: number; deletions?: number };
		};
	};
	artifact?: {
		kind?: string;
		patch?: string;
		summary?: { additions?: number; deletions?: number };
	};
	patch?: string;
}

function extractFilePathFromToolCall(
	toolName: string,
	content: unknown,
): string | null {
	if (!content || typeof content !== 'object') return null;

	const c = content as Record<string, unknown>;
	const args = c.args as Record<string, unknown> | undefined;

	const name = toolName.toLowerCase();

	if (name === 'write' || name === 'edit' || name === 'multiedit') {
		if (args && typeof args.path === 'string') return args.path;
		if (typeof c.path === 'string') return c.path;
	}
	if (name === 'copyinto' || name === 'copy_into') {
		if (args && typeof args.targetPath === 'string') return args.targetPath;
		if (typeof c.targetPath === 'string') return c.targetPath;
	}

	if (name === 'applypatch' || name === 'apply_patch') {
		const patch = args?.patch ?? c.patch;
		if (typeof patch === 'string') {
			const matches = [
				...patch.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g),
			];
			if (matches.length > 0) return matches[0][1].trim();
			const unifiedMatch = patch.match(/^(?:---|\+\+\+) [ab]\/(.+)$/m);
			if (unifiedMatch) return unifiedMatch[1].trim();
		}
		if (args && typeof args.path === 'string') return args.path;
		if (typeof c.path === 'string') return c.path;
	}

	return null;
}

function extractPatchFromToolCall(
	toolName: string,
	content: unknown,
): string | undefined {
	if (!content || typeof content !== 'object') return undefined;

	const c = content as Record<string, unknown>;
	const args = c.args as Record<string, unknown> | undefined;
	const name = toolName.toLowerCase();

	if (name === 'applypatch' || name === 'apply_patch') {
		const patch = args?.patch ?? c.patch;
		if (typeof patch === 'string') return patch;
	}

	return undefined;
}

function extractContentFromToolCall(
	toolName: string,
	content: unknown,
): string | undefined {
	if (!content || typeof content !== 'object') return undefined;

	const c = content as Record<string, unknown>;
	const args = c.args as Record<string, unknown> | undefined;
	const name = toolName.toLowerCase();

	if (name === 'write') {
		const writeContent = args?.content ?? c.content;
		if (typeof writeContent === 'string') return writeContent;
	}

	return undefined;
}

function extractFilesFromToolResult(
	toolName: string,
	content: unknown,
): string[] {
	if (!content || typeof content !== 'object') return [];

	const c = content as ToolResultData;
	const files: string[] = [];

	if (typeof c.path === 'string') {
		files.push(c.path);
	}

	const args = c.args;
	if (args && typeof args.path === 'string' && !files.includes(args.path)) {
		files.push(args.path);
	}
	if (
		args &&
		typeof args.targetPath === 'string' &&
		!files.includes(args.targetPath)
	) {
		files.push(args.targetPath);
	}
	if (typeof c.targetPath === 'string' && !files.includes(c.targetPath)) {
		files.push(c.targetPath);
	}

	if (Array.isArray(c.files)) {
		for (const f of c.files) {
			if (typeof f === 'string' && !files.includes(f)) files.push(f);
			if (f && typeof f === 'object' && typeof f.path === 'string') {
				if (!files.includes(f.path)) files.push(f.path);
			}
		}
	}

	const name = toolName.toLowerCase();
	if (name === 'applypatch' || name === 'apply_patch') {
		const patch =
			c.patch ??
			(args?.patch as string | undefined) ??
			c.result?.artifact?.patch;
		if (typeof patch === 'string') {
			const matches = patch.matchAll(
				/\*\*\* (?:Update|Add|Delete) File: (.+)/g,
			);
			for (const match of matches) {
				const fp = match[1].trim();
				if (!files.includes(fp)) files.push(fp);
			}
		}
	}

	return files;
}

function extractDataFromToolResult(
	toolName: string,
	content: unknown,
): {
	patch?: string;
	writeContent?: string;
	artifact?: FileOperation['artifact'];
} {
	if (!content || typeof content !== 'object') return {};

	const c = content as ToolResultData;
	const args = c.args as Record<string, unknown> | undefined;
	const name = toolName.toLowerCase();

	let patch: string | undefined;
	let writeContent: string | undefined;
	let artifact: FileOperation['artifact'] | undefined;

	if (name === 'applypatch' || name === 'apply_patch') {
		patch = (args?.patch as string | undefined) ?? c.patch;
	}

	if (
		(name === 'edit' || name === 'multiedit' || name === 'copy_into') &&
		typeof c.result?.artifact?.patch === 'string'
	) {
		patch = c.result.artifact.patch;
	}

	if (name === 'write') {
		writeContent = args?.content as string | undefined;
	}

	const rawArtifact = c.result?.artifact ?? c.artifact;
	if (rawArtifact && typeof rawArtifact === 'object') {
		artifact = {
			kind: rawArtifact.kind || 'unknown',
			patch: rawArtifact.patch,
			summary: rawArtifact.summary
				? {
						additions: rawArtifact.summary.additions || 0,
						deletions: rawArtifact.summary.deletions || 0,
					}
				: undefined,
		};
	}

	return { patch, writeContent, artifact };
}

function getOperationType(toolName: string): 'write' | 'patch' | 'create' {
	const name = toolName.toLowerCase();
	if (name === 'write') return 'write';
	if (name === 'edit' || name === 'multiedit' || name === 'copy_into')
		return 'patch';
	if (name === 'applypatch' || name === 'apply_patch') return 'patch';
	return 'write';
}

const sessionFilesParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
});

const sessionFilesQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const fileOperationSchema = z.object({
	path: z.string(),
	operation: z.enum(['write', 'patch', 'create']),
	timestamp: z.number().int(),
	toolCallId: z.string(),
	toolName: z.string(),
	patch: z.string().optional(),
	content: z.string().optional(),
	artifact: z
		.object({
			kind: z.string(),
			patch: z.string().optional(),
			summary: z
				.object({
					additions: z.number().int(),
					deletions: z.number().int(),
				})
				.optional(),
		})
		.optional(),
});

const sessionFileSchema = z.object({
	path: z.string(),
	operations: z.array(fileOperationSchema),
	operationCount: z.number().int(),
	firstModified: z.number().int(),
	lastModified: z.number().int(),
});

const sessionFilesResponseSchema = z.object({
	files: z.array(sessionFileSchema),
	totalFiles: z.number().int(),
	totalOperations: z.number().int(),
});

const sessionFilesErrorSchema = z.object({
	error: z.string(),
});

export function registerSessionFilesRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/files',
			tags: ['sessions'],
			operationId: 'getSessionFiles',
			summary: 'Get files modified in a session',
			request: {
				params: sessionFilesParamsSchema,
				query: sessionFilesQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: sessionFilesResponseSchema },
					},
				},
				'404': {
					description: 'Session not found',
					content: {
						'application/json': { schema: sessionFilesErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const sessionId = c.req.param('sessionId');
				const projectRoot = c.req.query('project') || process.cwd();
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);

				const sessionRows = await db
					.select()
					.from(sessions)
					.where(eq(sessions.id, sessionId))
					.limit(1);

				if (!sessionRows.length) {
					return c.json({ error: 'Session not found' }, 404);
				}

				const messageRows = await db
					.select({ id: messages.id })
					.from(messages)
					.where(eq(messages.sessionId, sessionId));

				const messageIds = messageRows.map((m) => m.id);

				if (!messageIds.length) {
					return c.json({
						files: [],
						totalFiles: 0,
						totalOperations: 0,
					});
				}

				const parts = await db
					.select()
					.from(messageParts)
					.where(
						and(
							inArray(messageParts.messageId, messageIds),
							inArray(messageParts.toolName, FILE_EDIT_TOOLS),
						),
					);

				const fileOperationsMap = new Map<string, FileOperation[]>();
				const toolCallDataMap = new Map<
					string,
					{ patch?: string; content?: string }
				>();

				for (const part of parts) {
					if (!part.toolName) continue;

					let content: unknown;
					try {
						content = JSON.parse(part.content);
					} catch {
						continue;
					}

					if (part.type === 'tool_call') {
						const callId = part.toolCallId || part.id;
						const patch = extractPatchFromToolCall(part.toolName, content);
						const writeContent = extractContentFromToolCall(
							part.toolName,
							content,
						);

						toolCallDataMap.set(callId, { patch, content: writeContent });

						const path = extractFilePathFromToolCall(part.toolName, content);
						if (path) {
							const operation: FileOperation = {
								path,
								operation: getOperationType(part.toolName),
								timestamp: part.startedAt || Date.now(),
								toolCallId: callId,
								toolName: part.toolName,
								patch,
								content: writeContent,
							};

							const existing = fileOperationsMap.get(path) || [];
							const isDuplicate = existing.some(
								(op) => op.toolCallId === operation.toolCallId,
							);
							if (!isDuplicate) {
								existing.push(operation);
								fileOperationsMap.set(path, existing);
							}
						}
					} else if (part.type === 'tool_result') {
						const filePaths = extractFilesFromToolResult(
							part.toolName,
							content,
						);
						const { patch, writeContent, artifact } = extractDataFromToolResult(
							part.toolName,
							content,
						);
						const callId = part.toolCallId || part.id;
						const callData = toolCallDataMap.get(callId);

						for (const filePath of filePaths) {
							if (!filePath) continue;

							const existing = fileOperationsMap.get(filePath) || [];
							const existingOp = existing.find(
								(op) => op.toolCallId === callId,
							);

							if (existingOp) {
								existingOp.artifact = artifact;
								existingOp.timestamp = part.completedAt || existingOp.timestamp;
								if (!existingOp.patch && patch) {
									existingOp.patch = patch;
								}
								if (!existingOp.content && writeContent) {
									existingOp.content = writeContent;
								}
							} else {
								const operation: FileOperation = {
									path: filePath,
									operation: getOperationType(part.toolName),
									timestamp: part.completedAt || part.startedAt || Date.now(),
									toolCallId: callId,
									toolName: part.toolName,
									patch: callData?.patch ?? patch,
									content: callData?.content ?? writeContent,
									artifact,
								};
								existing.push(operation);
								fileOperationsMap.set(filePath, existing);
							}
						}
					}
				}

				const files: SessionFile[] = [];
				for (const [path, operations] of fileOperationsMap) {
					operations.sort((a, b) => a.timestamp - b.timestamp);
					files.push({
						path,
						operations,
						operationCount: operations.length,
						firstModified: operations[0]?.timestamp || 0,
						lastModified: operations[operations.length - 1]?.timestamp || 0,
					});
				}

				files.sort((a, b) => b.lastModified - a.lastModified);

				return c.json({
					files,
					totalFiles: files.length,
					totalOperations: parts.length,
				});
			} catch (error) {
				logger.error('Failed to get session files', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
