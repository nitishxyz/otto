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
import { ToolHistoryTracker } from './tool-history-tracker.ts';
import { sanitizeToolResultForModel } from '../tools/result-sanitizer.ts';

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
						};
						if (obj.data && obj.mediaType) {
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
							type?: 'image' | 'pdf' | 'text';
							name?: string;
							data?: string;
							mediaType?: string;
							textContent?: string;
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
						} else if (obj.type === 'image' && obj.data && obj.mediaType) {
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

						const sanitizedResult = summarizeImageResultForHistory(
							obj.name,
							result.result,
						);
						const part = {
							type: toolType,
							state: 'output-available',
							toolCallId: obj.callId,
							input: obj.args,
							output: (() => {
								const r = sanitizedResult;
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
							result: sanitizedResult,
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

	return history;
}

function summarizeImageResultForHistory(
	toolName: string,
	result: unknown,
): unknown {
	const sanitized = sanitizeToolResultForModel(result);
	if (!resultHasImages(sanitized)) return sanitized;

	const record = sanitized as Record<string, unknown>;
	const images = record.images as Array<{ data?: string }>;
	const approxBytes = images.reduce((sum, image) => {
		return (
			sum + (typeof image.data === 'string' ? image.data.length * 0.75 : 0)
		);
	}, 0);
	return {
		ok: record.ok,
		message: `[${toolName} image result omitted from history; capture a fresh screenshot if visual detail is needed]`,
		artifact: record.artifact,
		omitted: true,
		omittedReason:
			'image tool result is only sent inline during the live tool turn',
		approxBytes: Math.round(approxBytes),
	};
}

function resultHasImages(result: unknown): boolean {
	return Boolean(
		result &&
			typeof result === 'object' &&
			Array.isArray((result as { images?: unknown }).images) &&
			(result as { images: unknown[] }).images.length > 0,
	);
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
