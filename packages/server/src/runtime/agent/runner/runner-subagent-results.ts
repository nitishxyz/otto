import type { DB } from '@ottocode/database';
import { messageParts, subagents } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { ModelMessage } from 'ai';
import {
	publishToolCall,
	publishToolResult,
} from '../../../tools/adapter/events.ts';
import type { ToolAdapterContext } from '../../tools/context.ts';
import { buildSubagentResultsPrompt } from '../../subagents/prompt.ts';

const SUBAGENT_RESULT_TOOL_NAME = 'subagent_result';

type PrepareStepArgs = {
	stepNumber: number;
	steps: unknown[];
	messages: ModelMessage[];
};

type PrepareStepResult = Record<string, unknown> & {
	messages?: ModelMessage[];
};

type PersistedResultPair = {
	callId: string;
	messages: ModelMessage[];
};

type RetainedResultPair = PersistedResultPair & {
	insertionIndex: number;
};

function hasToolCallId(messages: ModelMessage[], callId: string): boolean {
	return messages.some((message) => {
		if (!Array.isArray(message.content)) return false;
		return message.content.some(
			(part) =>
				typeof part === 'object' &&
				part !== null &&
				'toolCallId' in part &&
				part.toolCallId === callId,
		);
	});
}

function insertRetainedPairs(
	messages: ModelMessage[],
	pairs: RetainedResultPair[],
): ModelMessage[] {
	const result = [...messages];
	let offset = 0;
	for (const pair of pairs) {
		const insertionIndex = Math.min(
			pair.insertionIndex + offset,
			result.length,
		);
		if (!hasToolCallId(result, pair.callId)) {
			result.splice(insertionIndex, 0, ...pair.messages);
		}
		offset += pair.messages.length;
	}
	return result;
}

function buildResultMessages(args: {
	callId: string;
	subagentIds: string[];
	prompt: string;
}): ModelMessage[] {
	return [
		{
			role: 'assistant',
			content: [
				{
					type: 'tool-call',
					toolCallId: args.callId,
					toolName: SUBAGENT_RESULT_TOOL_NAME,
					input: { subagentIds: args.subagentIds },
				},
			],
		},
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: args.callId,
					toolName: SUBAGENT_RESULT_TOOL_NAME,
					output: { type: 'text', value: args.prompt },
				},
			],
		},
	];
}

async function persistFinishedSubagentResults(args: {
	db: DB;
	ctx: ToolAdapterContext;
	stepNumber: number;
}): Promise<PersistedResultPair | undefined> {
	const candidates = await args.db
		.select({ id: subagents.id })
		.from(subagents)
		.where(
			and(
				eq(subagents.parentSessionId, args.ctx.sessionId),
				eq(subagents.reported, false),
				ne(subagents.status, 'running'),
			),
		)
		.limit(1);
	if (!candidates.length) return undefined;

	const callIndex = await args.ctx.nextIndex();
	const resultIndex = await args.ctx.nextIndex();
	const callId = crypto.randomUUID();
	const now = Date.now();

	const persisted = args.db.transaction((tx) => {
		const finished = tx
			.select()
			.from(subagents)
			.where(
				and(
					eq(subagents.parentSessionId, args.ctx.sessionId),
					eq(subagents.reported, false),
					ne(subagents.status, 'running'),
				),
			)
			.orderBy(asc(subagents.createdAt))
			.all();
		if (!finished.length) return undefined;

		const subagentIds = finished.map((record) => record.id);
		const prompt = buildSubagentResultsPrompt(finished);
		const input = { subagentIds };

		tx.insert(messageParts)
			.values([
				{
					id: crypto.randomUUID(),
					messageId: args.ctx.messageId,
					index: callIndex,
					stepIndex: args.stepNumber,
					type: 'tool_call',
					content: JSON.stringify({
						name: SUBAGENT_RESULT_TOOL_NAME,
						args: input,
						callId,
					}),
					agent: args.ctx.agent,
					provider: args.ctx.provider,
					model: args.ctx.model,
					startedAt: now,
					completedAt: now,
					toolName: SUBAGENT_RESULT_TOOL_NAME,
					toolCallId: callId,
				},
				{
					id: crypto.randomUUID(),
					messageId: args.ctx.messageId,
					index: resultIndex,
					stepIndex: args.stepNumber,
					type: 'tool_result',
					content: JSON.stringify({
						name: SUBAGENT_RESULT_TOOL_NAME,
						result: prompt,
						callId,
					}),
					agent: args.ctx.agent,
					provider: args.ctx.provider,
					model: args.ctx.model,
					startedAt: now,
					completedAt: now,
					toolName: SUBAGENT_RESULT_TOOL_NAME,
					toolCallId: callId,
				},
			])
			.run();

		for (const record of finished) {
			tx.update(subagents)
				.set({ reported: true, updatedAt: now })
				.where(eq(subagents.id, record.id))
				.run();
		}

		return { subagentIds, prompt };
	});
	if (!persisted) return undefined;

	publishToolCall(args.ctx, {
		name: SUBAGENT_RESULT_TOOL_NAME,
		input: { subagentIds: persisted.subagentIds },
		callId,
		stepIndex: args.stepNumber,
	});
	publishToolResult(
		args.ctx,
		{
			name: SUBAGENT_RESULT_TOOL_NAME,
			result: persisted.prompt,
			callId,
			args: { subagentIds: persisted.subagentIds },
		},
		args.stepNumber,
	);

	return {
		callId,
		messages: buildResultMessages({
			callId,
			subagentIds: persisted.subagentIds,
			prompt: persisted.prompt,
		}),
	};
}

/**
 * Persists completed sub-agent results on the active assistant message and
 * injects them into the next model step. The idle reporter remains the
 * fallback when the active turn has no subsequent step.
 */
export function withSubagentResultsPrepareStep(
	inner: ((args: PrepareStepArgs) => unknown) | undefined,
	context: { db: DB; ctx: ToolAdapterContext },
): (args: PrepareStepArgs) => Promise<PrepareStepResult | undefined> {
	const retainedPairs: RetainedResultPair[] = [];
	return async (args) => {
		const innerResult = inner ? await inner(args) : undefined;
		const base =
			innerResult && typeof innerResult === 'object'
				? (innerResult as PrepareStepResult)
				: {};
		const messages = base.messages ?? args.messages;
		try {
			const persisted = await persistFinishedSubagentResults({
				db: context.db,
				ctx: context.ctx,
				stepNumber: args.stepNumber,
			});
			if (persisted) {
				const retainedMessagesInBase = retainedPairs.reduce(
					(count, pair) =>
						count +
						(hasToolCallId(messages, pair.callId) ? pair.messages.length : 0),
					0,
				);
				retainedPairs.push({
					...persisted,
					insertionIndex: Math.max(0, messages.length - retainedMessagesInBase),
				});
			}
		} catch (error) {
			logger.warn('[subagent] failed to inject finished results', {
				sessionId: context.ctx.sessionId,
				messageId: context.ctx.messageId,
				error: error instanceof Error ? error.message : String(error),
			});
		}

		if (!retainedPairs.length) {
			return innerResult && typeof innerResult === 'object'
				? (innerResult as PrepareStepResult)
				: undefined;
		}

		return {
			...base,
			messages: insertRetainedPairs(messages, retainedPairs),
		};
	};
}
