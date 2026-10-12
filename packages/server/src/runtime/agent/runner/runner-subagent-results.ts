import type { DB } from '@ottocode/database';
import { messageParts, sessions, subagents } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { ModelMessage } from 'ai';
import {
	type PrepareStepArgs,
	type PrepareStepFn,
	type PrepareStepResult,
	type ResultPair,
	withRetainedResultPairs,
} from '../turn/prepare-step.ts';
import {
	publishToolCall,
	publishToolResult,
} from '../../../tools/adapter/events.ts';
import type { ToolAdapterContext } from '../../tools/context.ts';
import { buildSubagentResultsPrompt } from '../../subagents/prompt.ts';
import { getModelLimits } from '../../message/compaction.ts';
import {
	claimSubagentResults,
	SubagentResultClaimConflictError,
} from '../../subagents/report.ts';

const SUBAGENT_RESULT_TOOL_NAME = 'subagent_result';

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
}): Promise<ResultPair | undefined> {
	const candidates = await args.db
		.select({ id: subagents.id })
		.from(subagents)
		.where(
			and(
				eq(subagents.parentSessionId, args.ctx.sessionId),
				eq(subagents.deliveryState, 'pending'),
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
					eq(subagents.deliveryState, 'pending'),
					ne(subagents.status, 'running'),
				),
			)
			.orderBy(asc(subagents.createdAt))
			.all();
		if (!finished.length) return undefined;

		const subagentIds = finished.map((record) => record.id);
		const contextRows = tx
			.select({
				id: sessions.id,
				tokens: sessions.currentContextTokens,
				provider: sessions.provider,
				model: sessions.model,
			})
			.from(sessions)
			.where(
				inArray(
					sessions.id,
					finished.map((record) => record.childSessionId),
				),
			)
			.all();
		const contextBySession = new Map(
			contextRows.map((row) => [
				row.id,
				{
					tokens: row.tokens,
					window: getModelLimits(row.provider, row.model)?.context ?? null,
				},
			]),
		);
		const prompt = buildSubagentResultsPrompt(
			finished.map((record) => ({
				...record,
				contextTokens:
					contextBySession.get(record.childSessionId)?.tokens ?? null,
				contextWindowTokens:
					contextBySession.get(record.childSessionId)?.window ?? null,
			})),
		);
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

		claimSubagentResults(tx, {
			parentSessionId: args.ctx.sessionId,
			deliveryKey: callId,
			claims: finished,
		});

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
	inner: PrepareStepFn | undefined,
	context: { db: DB; ctx: ToolAdapterContext },
): (args: PrepareStepArgs) => Promise<PrepareStepResult | undefined> {
	return withRetainedResultPairs(
		inner,
		async (args) => {
			try {
				return await persistFinishedSubagentResults({
					db: context.db,
					ctx: context.ctx,
					stepNumber: args.stepNumber,
				});
			} catch (error) {
				if (error instanceof SubagentResultClaimConflictError) return undefined;
				throw error;
			}
		},
		(error) => {
			logger.warn('[subagent] failed to inject finished results', {
				sessionId: context.ctx.sessionId,
				messageId: context.ctx.messageId,
				error: error instanceof Error ? error.message : String(error),
			});
		},
	);
}
