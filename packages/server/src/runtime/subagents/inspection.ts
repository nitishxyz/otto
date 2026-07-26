import type { DB } from '@ottocode/database';
import {
	messageParts,
	messages,
	sessions,
	subagents,
} from '@ottocode/database/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getModelLimits } from '../message/compaction.ts';
import { getQueueState } from '../session/queue.ts';

const PREVIEW_LIMIT = 600;

export type SubagentContextStatus = {
	usedTokens: number;
	windowTokens: number | null;
	remainingTokens: number | null;
	percentUsed: number | null;
	lastCompactedAt: number | null;
};

export type SubagentStatus = {
	id: string;
	childSessionId: string;
	agent: string;
	task: string;
	status: string;
	summary: string | null;
	provider: string;
	model: string;
	context: SubagentContextStatus;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cachedTokens: number;
		cacheCreationTokens: number;
		reasoningTokens: number;
		toolTimeMs: number;
		toolCalls: number;
	};
	execution: {
		isRunning: boolean;
		currentMessageId: string | null;
		queuedMessages: number;
	};
	createdAt: number;
	updatedAt: number;
};

export type SubagentActivity = {
	toolCallId: string | null;
	tool: string;
	step: number | null;
	status: 'running' | 'completed' | 'failed';
	input?: string;
	result?: string;
	startedAt: number | null;
	completedAt: number | null;
	durationMs: number | null;
};

export type GetSubagentStatusResult =
	| { ok: true; subagent: SubagentStatus }
	| { ok: false; error: string };

export type ReadSubagentActivityResult =
	| {
			ok: true;
			subagent: SubagentStatus;
			activity: SubagentActivity[];
	  }
	| { ok: false; error: string };

/** Returns ownership-scoped lifecycle, execution, usage, and context status. */
export async function getSubagentStatus(args: {
	db: DB;
	parentSessionId: string;
	subagentId: string;
}): Promise<GetSubagentStatusResult> {
	const rows = await args.db
		.select({ record: subagents, session: sessions })
		.from(subagents)
		.innerJoin(sessions, eq(sessions.id, subagents.childSessionId))
		.where(
			and(
				eq(subagents.id, args.subagentId),
				eq(subagents.parentSessionId, args.parentSessionId),
			),
		)
		.limit(1);
	const row = rows[0];
	if (!row) {
		return {
			ok: false,
			error: `No sub-agent with id "${args.subagentId}" for this session. Use subagent action=list to find ids.`,
		};
	}

	const { record, session } = row;
	const limits = getModelLimits(session.provider, session.model);
	const usedTokens = Math.max(0, session.currentContextTokens ?? 0);
	const windowTokens = limits?.context ?? null;
	const queue = getQueueState(session.id);
	return {
		ok: true,
		subagent: {
			id: record.id,
			childSessionId: record.childSessionId,
			agent: record.agent,
			task: record.task,
			status: record.status,
			summary: record.summary,
			provider: session.provider,
			model: session.model,
			context: {
				usedTokens,
				windowTokens,
				remainingTokens:
					windowTokens === null ? null : Math.max(0, windowTokens - usedTokens),
				percentUsed:
					windowTokens === null
						? null
						: Math.round((usedTokens / windowTokens) * 1000) / 10,
				lastCompactedAt: session.lastCompactedAt,
			},
			usage: {
				inputTokens: session.totalInputTokens ?? 0,
				outputTokens: session.totalOutputTokens ?? 0,
				cachedTokens: session.totalCachedTokens ?? 0,
				cacheCreationTokens: session.totalCacheCreationTokens ?? 0,
				reasoningTokens: session.totalReasoningTokens ?? 0,
				toolTimeMs: session.totalToolTimeMs ?? 0,
				toolCalls: countToolCalls(session.toolCountsJson),
			},
			execution: {
				isRunning: queue?.isRunning ?? false,
				currentMessageId: queue?.currentMessageId ?? null,
				queuedMessages: queue?.queuedMessages.length ?? 0,
			},
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		},
	};
}

/** Returns a bounded newest-first overview of a sub-agent's recent tool calls. */
export async function readSubagentActivity(args: {
	db: DB;
	parentSessionId: string;
	subagentId: string;
	limit: number;
}): Promise<ReadSubagentActivityResult> {
	const status = await getSubagentStatus(args);
	if (!status.ok) return status;
	const limit = Math.min(20, Math.max(1, Math.floor(args.limit)));

	const calls = await args.db
		.select({
			toolCallId: messageParts.toolCallId,
			toolName: messageParts.toolName,
			stepIndex: messageParts.stepIndex,
			content: messageParts.content,
			startedAt: messageParts.startedAt,
			completedAt: messageParts.completedAt,
			toolDurationMs: messageParts.toolDurationMs,
			messageCreatedAt: messages.createdAt,
		})
		.from(messageParts)
		.innerJoin(messages, eq(messages.id, messageParts.messageId))
		.where(
			and(
				eq(messages.sessionId, status.subagent.childSessionId),
				eq(messageParts.type, 'tool_call'),
			),
		)
		.orderBy(desc(messages.createdAt), desc(messageParts.index))
		.limit(limit);

	const callIds = calls
		.map((call) => call.toolCallId)
		.filter((id): id is string => Boolean(id));
	const results = callIds.length
		? await args.db
				.select({
					toolCallId: messageParts.toolCallId,
					content: messageParts.content,
					completedAt: messageParts.completedAt,
					toolDurationMs: messageParts.toolDurationMs,
				})
				.from(messageParts)
				.innerJoin(messages, eq(messages.id, messageParts.messageId))
				.where(
					and(
						eq(messages.sessionId, status.subagent.childSessionId),
						eq(messageParts.type, 'tool_result'),
						inArray(messageParts.toolCallId, callIds),
					),
				)
		: [];
	const resultsByCallId = new Map(
		results
			.filter((result) => result.toolCallId)
			.map((result) => [result.toolCallId as string, result]),
	);

	return {
		ok: true,
		subagent: status.subagent,
		activity: calls.map((call) => {
			const callPayload = parseRecord(call.content);
			const resultPart = call.toolCallId
				? resultsByCallId.get(call.toolCallId)
				: undefined;
			const resultPayload = resultPart
				? parseRecord(resultPart.content)
				: undefined;
			const resultValue = resultPayload?.result;
			const failed =
				isFailureResult(resultValue) || resultPayload?.state === 'output-error';
			return {
				toolCallId: call.toolCallId,
				tool: call.toolName ?? readString(callPayload?.name) ?? 'unknown',
				step: call.stepIndex,
				status: resultPart ? (failed ? 'failed' : 'completed') : 'running',
				input: toPreview(callPayload?.args),
				result: toPreview(resultValue),
				startedAt: call.startedAt ?? call.messageCreatedAt,
				completedAt: resultPart?.completedAt ?? call.completedAt,
				durationMs: resultPart?.toolDurationMs ?? call.toolDurationMs,
			};
		}),
	};
}

function countToolCalls(value: string | null): number {
	if (!value) return 0;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			return 0;
		return Object.values(parsed).reduce<number>(
			(total, count) =>
				total + (typeof count === 'number' && count > 0 ? count : 0),
			0,
		);
	} catch {
		return 0;
	}
}

function parseRecord(value: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isFailureResult(value: unknown): boolean {
	return Boolean(
		value &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			(value as Record<string, unknown>).ok === false,
	);
}

function toPreview(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	let text: string;
	if (typeof value === 'string') text = value;
	else {
		try {
			text = JSON.stringify(value);
		} catch {
			text = String(value);
		}
	}
	return text.length > PREVIEW_LIMIT
		? `${text.slice(0, PREVIEW_LIMIT - 1)}…`
		: text;
}
