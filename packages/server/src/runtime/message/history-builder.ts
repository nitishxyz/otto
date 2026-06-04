import {
	convertToModelMessages,
	type FilePart,
	type ModelMessage,
	type TextPart,
	type UIMessage,
} from 'ai';
import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { eq, asc, inArray } from 'drizzle-orm';
import { stripToolResultArtifactsForModel } from '../../tools/adapter/results.ts';
import { ToolHistoryTracker } from './tool-history-tracker.ts';

type MessagePartRow = typeof messageParts.$inferSelect;

const MODEL_HISTORY_MAX_BYTES = 1_500_000;
const COMPACTED_OLD_TEXT_BYTES = 1_000;

function getReadResultKey(part: MessagePartRow): string | undefined {
	if (part.type !== 'tool_result' || part.compactedAt) return undefined;
	try {
		const content = JSON.parse(part.content ?? '{}') as {
			name?: string;
			result?: unknown;
		};
		if (content.name !== 'read') return undefined;
		if (
			!content.result ||
			typeof content.result !== 'object' ||
			Array.isArray(content.result)
		) {
			return undefined;
		}
		const result = content.result as Record<string, unknown>;
		if (result.ok === false || typeof result.path !== 'string')
			return undefined;
		const lineRange =
			typeof result.lineRange === 'string' ? result.lineRange : 'full';
		return `${result.path}\u0000${lineRange}`;
	} catch {
		return undefined;
	}
}

function findLatestUserImageMessageId(
	rows: Array<typeof messages.$inferSelect>,
	partsByMessageId: Map<string, MessagePartRow[]>,
): string | undefined {
	for (let index = rows.length - 1; index >= 0; index--) {
		const row = rows[index];
		if (row.role !== 'user') continue;
		const parts = partsByMessageId.get(row.id) ?? [];
		if (parts.some((part) => part.type === 'image')) return row.id;
	}
	return undefined;
}

function jsonByteLength(value: unknown): number {
	try {
		return Buffer.byteLength(JSON.stringify(value), 'utf8');
	} catch {
		return Buffer.byteLength(String(value), 'utf8');
	}
}

function hasToolishContent(message: ModelMessage): boolean {
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return false;
	return content.some((part) => {
		if (!part || typeof part !== 'object') return false;
		const type = (part as { type?: unknown }).type;
		return typeof type === 'string' && type.startsWith('tool-');
	});
}

function compactOldMessageText(message: ModelMessage): boolean {
	if (hasToolishContent(message)) return false;
	const mutable = message as { content?: unknown };
	if (typeof mutable.content === 'string') {
		if (
			Buffer.byteLength(mutable.content, 'utf8') <= COMPACTED_OLD_TEXT_BYTES
		) {
			return false;
		}
		mutable.content = `${mutable.content.slice(0, COMPACTED_OLD_TEXT_BYTES)}\n… older message text compacted to keep model history under budget …`;
		return true;
	}
	if (!Array.isArray(mutable.content)) return false;

	let changed = false;
	mutable.content = mutable.content.map((part) => {
		if (!part || typeof part !== 'object') return part;
		const record = part as Record<string, unknown>;
		if (record.type !== 'text' || typeof record.text !== 'string') return part;
		if (Buffer.byteLength(record.text, 'utf8') <= COMPACTED_OLD_TEXT_BYTES) {
			return part;
		}
		changed = true;
		return {
			...record,
			text: `${record.text.slice(0, COMPACTED_OLD_TEXT_BYTES)}\n… older message text compacted to keep model history under budget …`,
		};
	});
	return changed;
}

function enforceModelHistoryBudget(history: ModelMessage[]): ModelMessage[] {
	let totalBytes = jsonByteLength(history);
	if (totalBytes <= MODEL_HISTORY_MAX_BYTES) return history;

	for (let index = 0; index < history.length - 4; index++) {
		if (!compactOldMessageText(history[index])) continue;
		totalBytes = jsonByteLength(history);
		if (totalBytes <= MODEL_HISTORY_MAX_BYTES) break;
	}
	return history;
}

function findSupersededReadPartIds(parts: MessagePartRow[]): Set<string> {
	const latestPartIdByReadKey = new Map<string, string>();
	const readKeyByPartId = new Map<string, string>();
	for (const part of parts) {
		const key = getReadResultKey(part);
		if (!key) continue;
		readKeyByPartId.set(part.id, key);
		latestPartIdByReadKey.set(key, part.id);
	}

	const superseded = new Set<string>();
	for (const [partId, key] of readKeyByPartId) {
		if (latestPartIdByReadKey.get(key) !== partId) superseded.add(partId);
	}
	return superseded;
}

/**
 * Builds the conversation history for a session from the database,
 * converting it to the format expected by the AI SDK.
 */
export async function buildHistoryMessages(
	db: Awaited<ReturnType<typeof getDb>>,
	sessionId: string,
	_currentMessageId?: string,
): Promise<ModelMessage[]> {
	const rows = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(asc(messages.createdAt));
	const messageIds = rows.map((row) => row.id);
	const allParts = messageIds.length
		? await db
				.select()
				.from(messageParts)
				.where(inArray(messageParts.messageId, messageIds))
				.orderBy(asc(messageParts.messageId), asc(messageParts.index))
		: [];
	const partsByMessageId = new Map<
		string,
		(typeof messageParts.$inferSelect)[]
	>();
	for (const part of allParts) {
		const existing = partsByMessageId.get(part.messageId);
		if (existing) {
			existing.push(part);
			continue;
		}
		partsByMessageId.set(part.messageId, [part]);
	}
	const orderedParts = rows.flatMap(
		(row) => partsByMessageId.get(row.id) ?? [],
	);
	const supersededReadPartIds = findSupersededReadPartIds(orderedParts);
	const latestUserImageMessageId = findLatestUserImageMessageId(
		rows,
		partsByMessageId,
	);

	const history: ModelMessage[] = [];
	const toolHistory = new ToolHistoryTracker();

	for (const m of rows) {
		const parts = partsByMessageId.get(m.id) ?? [];

		if (
			m.role === 'assistant' &&
			m.status !== 'complete' &&
			m.status !== 'completed' &&
			m.status !== 'error'
		) {
			if (parts.length === 0) {
				continue;
			}
		}

		if (m.role === 'user') {
			const userParts: Array<TextPart | FilePart> = [];
			for (const p of parts) {
				if (p.type === 'text') {
					try {
						const obj = JSON.parse(p.content ?? '{}');
						const t = String(obj.text ?? '');
						if (t) userParts.push({ type: 'text', text: t });
					} catch {}
				} else if (p.type === 'image') {
					try {
						const obj = JSON.parse(p.content ?? '{}') as {
							data?: string;
							mediaType?: string;
							attachmentId?: string;
							name?: string;
							original?: { filename?: string; size?: number; sha256?: string };
						};
						if (
							m.id === latestUserImageMessageId &&
							obj.data &&
							obj.mediaType
						) {
							userParts.push({
								type: 'file',
								data: obj.data,
								mediaType: obj.mediaType,
							});
						}
					} catch {}
				} else if (p.type === 'file') {
					try {
						const obj = JSON.parse(p.content ?? '{}') as {
							type?: 'image' | 'pdf' | 'text' | 'binary';
							name?: string;
							data?: string;
							mediaType?: string;
							textContent?: string;
							attachmentId?: string;
							original?: { filename?: string; size?: number; sha256?: string };
						};
						if (obj.type === 'text' && obj.textContent) {
							userParts.push({
								type: 'text',
								text: `<file name="${obj.name || 'file'}">\n${obj.textContent}\n</file>`,
							});
						} else if (obj.type === 'pdf' && obj.data && obj.mediaType) {
							userParts.push({
								type: 'file',
								data: obj.data,
								filename: obj.name,
								mediaType: obj.mediaType,
							});
						} else if (
							obj.type === 'image' &&
							obj.data &&
							obj.mediaType &&
							m.id === latestUserImageMessageId
						) {
							userParts.push({
								type: 'file',
								data: obj.data,
								filename: obj.name,
								mediaType: obj.mediaType,
							});
						}
					} catch {}
				}
			}
			if (userParts.length) {
				history.push({ role: 'user', content: userParts });
			}
			continue;
		}

		if (m.role === 'assistant') {
			const assistantParts: UIMessage['parts'] = [];
			const flushAssistantParts = async () => {
				if (!assistantParts.length) return;
				history.push(
					...(await convertToModelMessages([
						{ role: 'assistant', parts: assistantParts },
					])),
				);
				assistantParts.length = 0;
			};
			const toolResultsById = new Map<
				string,
				{
					name: string;
					callId: string;
					partId?: string;
					result: unknown;
				}
			>();

			for (const p of parts) {
				if (p.type !== 'tool_result' || p.compactedAt) continue;

				try {
					const obj = JSON.parse(p.content ?? '{}') as {
						name?: string;
						callId?: string;
						result?: unknown;
					};
					if (obj.callId) {
						toolResultsById.set(obj.callId, {
							name: obj.name ?? 'tool',
							callId: obj.callId,
							partId: p.id,
							result: obj.result,
						});
					}
				} catch {}
			}

			for (const p of parts) {
				if (p.type === 'reasoning') continue;

				if (p.type === 'text') {
					try {
						const obj = JSON.parse(p.content ?? '{}');
						const t = String(obj.text ?? '');
						if (t) assistantParts.push({ type: 'text', text: t });
					} catch {}
				} else if (p.type === 'tool_call') {
					if (p.compactedAt) continue;

					try {
						const obj = JSON.parse(p.content ?? '{}') as {
							name?: string;
							callId?: string;
							args?: unknown;
						};
						if (!obj.callId || !obj.name) continue;
						if (obj.name === 'finish') continue;

						const toolType = `tool-${obj.name}` as `tool-${string}`;
						let result = toolResultsById.get(obj.callId);

						if (!result) {
							result = {
								name: obj.name,
								callId: obj.callId,
								result:
									'Error: The tool execution was interrupted or failed to return a result. You may need to retry this operation.',
							};
						}

						const part = {
							type: toolType,
							state: 'output-available',
							toolCallId: obj.callId,
							input: obj.args,
							output: (() => {
								const r = stripToolResultArtifactsForModel(result.result, {
									toolName: result.name,
									compactedReason:
										result.name === 'read' &&
										result.partId &&
										supersededReadPartIds.has(result.partId)
											? 'Superseded by a later read of the same file and line range.'
											: undefined,
								});
								if (typeof r === 'string') return r;
								try {
									return JSON.stringify(r);
								} catch {
									return String(r);
								}
							})(),
						};

						toolHistory.register(part, {
							toolName: obj.name,
							callId: obj.callId,
							args: obj.args,
							result: stripToolResultArtifactsForModel(result.result, {
								toolName: result.name,
								compactedReason:
									result.name === 'read' &&
									result.partId &&
									supersededReadPartIds.has(result.partId)
										? 'Superseded by a later read of the same file and line range.'
										: undefined,
							}),
						});

						assistantParts.push(part as never);
						await flushAssistantParts();
					} catch {}
				}
			}

			if (assistantParts.length) {
				await flushAssistantParts();
			}
		}
	}

	return enforceModelHistoryBudget(history);
}

async function _logPendingToolParts(
	db: Awaited<ReturnType<typeof getDb>>,
	messageId: string,
) {
	try {
		const parts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, messageId))
			.orderBy(asc(messageParts.index));

		const pendingCalls: string[] = [];
		for (const part of parts) {
			if (part.type !== 'tool_call') continue;
			try {
				const obj = JSON.parse(part.content ?? '{}') as {
					name?: string;
					callId?: string;
				};
				if (obj.name && obj.callId) {
					const resultExists = parts.some((candidate) => {
						if (candidate.type !== 'tool_result') return false;
						try {
							const parsed = JSON.parse(candidate.content ?? '{}') as {
								callId?: string;
							};
							return parsed.callId === obj.callId;
						} catch {
							return false;
						}
					});
					if (!resultExists) {
						pendingCalls.push(`${obj.name}#${obj.callId}`);
					}
				}
			} catch {}
		}
		void pendingCalls;
	} catch {}
}
