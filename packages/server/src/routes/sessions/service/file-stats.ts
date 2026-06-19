import { messageParts, messages } from '@ottocode/database/schema';
import { and, inArray } from 'drizzle-orm';
import type {
	ProjectDbContext,
	SessionFileStats,
	SessionRow,
} from './types.ts';

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

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function getNumber(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function addStringFile(files: Set<string>, value: unknown) {
	if (typeof value === 'string' && value.trim()) {
		files.add(value.trim());
	}
}

function addPatchFiles(files: Set<string>, patch: unknown) {
	if (typeof patch !== 'string') return;
	for (const match of patch.matchAll(
		/\*\*\* (?:Update|Add|Delete) File: (.+)/g,
	)) {
		addStringFile(files, match[1]);
	}
	const unifiedMatch = patch.match(/^(?:---|\+\+\+) [ab]\/(.+)$/m);
	if (unifiedMatch) addStringFile(files, unifiedMatch[1]);
}

function extractFilesFromToolContent(content: unknown): Set<string> {
	const files = new Set<string>();
	const data = getRecord(content);
	if (!data) return files;

	const args = getRecord(data.args);
	addStringFile(files, data.path);
	addStringFile(files, data.targetPath);
	addStringFile(files, args?.path);
	addStringFile(files, args?.targetPath);

	const rawFiles = data.files;
	if (Array.isArray(rawFiles)) {
		for (const file of rawFiles) {
			if (typeof file === 'string') addStringFile(files, file);
			else addStringFile(files, getRecord(file)?.path);
		}
	}

	addPatchFiles(files, data.patch ?? args?.patch);
	const result = getRecord(data.result);
	const resultArtifact = getRecord(result?.artifact);
	addPatchFiles(files, resultArtifact?.patch);

	return files;
}

function extractArtifactSummary(content: unknown) {
	const data = getRecord(content);
	const artifact =
		getRecord(getRecord(data?.result)?.artifact) ?? getRecord(data?.artifact);
	const summary = getRecord(artifact?.summary);
	return {
		files: getNumber(summary?.files),
		additions: getNumber(summary?.additions),
		deletions: getNumber(summary?.deletions),
	};
}

export async function getSessionFileStats(
	db: ProjectDbContext['db'],
	rows: SessionRow[],
): Promise<Map<string, SessionFileStats>> {
	const sessionIds = rows.map((row) => row.id);
	const statsBySessionId = new Map<string, SessionFileStats>();
	if (sessionIds.length === 0) return statsBySessionId;

	for (const sessionId of sessionIds) {
		statsBySessionId.set(sessionId, {
			changedFiles: 0,
			additions: 0,
			deletions: 0,
			operations: 0,
		});
	}

	const messageRows = await db
		.select({ id: messages.id, sessionId: messages.sessionId })
		.from(messages)
		.where(inArray(messages.sessionId, sessionIds));
	if (messageRows.length === 0) return statsBySessionId;

	const sessionIdByMessageId = new Map(
		messageRows.map((message) => [message.id, message.sessionId]),
	);
	const parts = await db
		.select({
			messageId: messageParts.messageId,
			type: messageParts.type,
			toolName: messageParts.toolName,
			content: messageParts.content,
		})
		.from(messageParts)
		.where(
			and(
				inArray(
					messageParts.messageId,
					messageRows.map((message) => message.id),
				),
				inArray(messageParts.toolName, FILE_EDIT_TOOLS),
			),
		);

	const fileSetsBySessionId = new Map<string, Set<string>>();
	const minimumFileCounts = new Map<string, number>();

	for (const part of parts) {
		const sessionId = sessionIdByMessageId.get(part.messageId);
		if (!sessionId || !part.toolName) continue;

		let content: unknown;
		try {
			content = JSON.parse(part.content);
		} catch {
			continue;
		}

		let fileSet = fileSetsBySessionId.get(sessionId);
		if (!fileSet) {
			fileSet = new Set<string>();
			fileSetsBySessionId.set(sessionId, fileSet);
		}
		for (const file of extractFilesFromToolContent(content)) fileSet.add(file);

		if (part.type === 'tool_result') {
			const stats = statsBySessionId.get(sessionId);
			if (!stats) continue;
			const summary = extractArtifactSummary(content);
			stats.operations++;
			stats.additions += summary.additions;
			stats.deletions += summary.deletions;
			minimumFileCounts.set(
				sessionId,
				Math.max(minimumFileCounts.get(sessionId) ?? 0, summary.files),
			);
		}
	}

	for (const [sessionId, stats] of statsBySessionId) {
		stats.changedFiles = Math.max(
			fileSetsBySessionId.get(sessionId)?.size ?? 0,
			minimumFileCounts.get(sessionId) ?? 0,
		);
	}

	return statsBySessionId;
}
