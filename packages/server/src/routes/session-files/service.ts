import { getDb } from '@ottocode/database';
import { messages, messageParts, sessions } from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import { FILE_EDIT_TOOLS } from './constants.ts';
import {
	extractContentFromToolCall,
	extractDataFromToolResult,
	extractFilePathsFromToolCall,
	extractFilesFromToolResult,
	extractPatchFromToolCall,
	getOperationType,
} from './extract.ts';
import type { FileOperation, SessionFile } from './types.ts';

export async function getSessionFiles(
	sessionId: string,
	projectRoot: string,
): Promise<{
	files: SessionFile[];
	totalFiles: number;
	totalOperations: number;
}> {
	const cfg = await loadConfig(projectRoot);
	const db = await getDb(cfg.projectRoot);

	const sessionRows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, sessionId))
		.limit(1);

	if (!sessionRows.length) {
		throw Object.assign(new Error('Session not found'), { status: 404 });
	}

	const messageRows = await db
		.select({ id: messages.id })
		.from(messages)
		.where(eq(messages.sessionId, sessionId));

	const messageIds = messageRows.map((m) => m.id);

	if (!messageIds.length) {
		return {
			files: [],
			totalFiles: 0,
			totalOperations: 0,
		};
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

	const files = collectSessionFiles(parts);

	return {
		files,
		totalFiles: files.length,
		totalOperations: parts.length,
	};
}

function collectSessionFiles(parts: Array<typeof messageParts.$inferSelect>) {
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
			recordToolCall(fileOperationsMap, toolCallDataMap, part, content);
		} else if (part.type === 'tool_result') {
			recordToolResult(fileOperationsMap, toolCallDataMap, part, content);
		}
	}

	return sortSessionFiles(fileOperationsMap);
}

function recordToolCall(
	fileOperationsMap: Map<string, FileOperation[]>,
	toolCallDataMap: Map<string, { patch?: string; content?: string }>,
	part: typeof messageParts.$inferSelect,
	content: unknown,
): void {
	if (!part.toolName) return;
	const callId = part.toolCallId || part.id;
	const patch = extractPatchFromToolCall(part.toolName, content);
	const writeContent = extractContentFromToolCall(part.toolName, content);

	toolCallDataMap.set(callId, { patch, content: writeContent });

	const paths = extractFilePathsFromToolCall(part.toolName, content);
	if (paths.length === 0) return;

	for (const path of paths) {
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
}

function recordToolResult(
	fileOperationsMap: Map<string, FileOperation[]>,
	toolCallDataMap: Map<string, { patch?: string; content?: string }>,
	part: typeof messageParts.$inferSelect,
	content: unknown,
): void {
	if (!part.toolName) return;
	const filePaths = extractFilesFromToolResult(part.toolName, content);
	const { patch, writeContent, artifact } = extractDataFromToolResult(
		part.toolName,
		content,
	);
	const callId = part.toolCallId || part.id;
	const callData = toolCallDataMap.get(callId);

	for (const filePath of filePaths) {
		if (!filePath) continue;

		const existing = fileOperationsMap.get(filePath) || [];
		const existingOp = existing.find((op) => op.toolCallId === callId);

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

function sortSessionFiles(fileOperationsMap: Map<string, FileOperation[]>) {
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
	return files;
}
