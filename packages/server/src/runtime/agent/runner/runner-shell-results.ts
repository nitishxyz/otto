import type { DB } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import type { ModelMessage } from 'ai';
import {
	publishToolCall,
	publishToolResult,
} from '../../../tools/adapter/events.ts';
import type { ToolAdapterContext } from '../../tools/context.ts';
import {
	claimFinishedShellJobs,
	markShellJobsReported,
	releaseClaimedShellJobs,
} from '../../tools/active-shells.ts';
import { buildShellJobResultsPrompt } from '../../shell-jobs/prompt.ts';

const SHELL_RESULT_TOOL_NAME = 'shell_result';

type PrepareStepArgs = {
	stepNumber: number;
	steps: unknown[];
	messages: ModelMessage[];
};

type PrepareStepResult = Record<string, unknown> & {
	messages?: ModelMessage[];
};

type ResultPair = {
	callId: string;
	messages: ModelMessage[];
};

type RetainedResultPair = ResultPair & {
	insertionIndex: number;
};

function hasToolCallId(messages: ModelMessage[], callId: string): boolean {
	return messages.some((message) =>
		Array.isArray(message.content)
			? message.content.some(
					(part) =>
						typeof part === 'object' &&
						part !== null &&
						'toolCallId' in part &&
						part.toolCallId === callId,
				)
			: false,
	);
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
	jobIds: string[];
	prompt: string;
}): ModelMessage[] {
	return [
		{
			role: 'assistant',
			content: [
				{
					type: 'tool-call',
					toolCallId: args.callId,
					toolName: SHELL_RESULT_TOOL_NAME,
					input: { jobIds: args.jobIds },
				},
			],
		},
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: args.callId,
					toolName: SHELL_RESULT_TOOL_NAME,
					output: { type: 'text', value: args.prompt },
				},
			],
		},
	];
}

async function persistFinishedShellResults(args: {
	db: DB;
	ctx: ToolAdapterContext;
	stepNumber: number;
}): Promise<ResultPair | undefined> {
	const jobs = claimFinishedShellJobs(args.ctx.sessionId);
	if (!jobs.length) return undefined;
	const jobIds = jobs.map((job) => job.id);
	const callId = crypto.randomUUID();
	try {
		const callIndex = await args.ctx.nextIndex();
		const resultIndex = await args.ctx.nextIndex();
		const prompt = buildShellJobResultsPrompt(jobs);
		const input = { jobIds };
		const now = Date.now();
		args.db.transaction((tx) => {
			tx.insert(messageParts)
				.values([
					{
						id: crypto.randomUUID(),
						messageId: args.ctx.messageId,
						index: callIndex,
						stepIndex: args.stepNumber,
						type: 'tool_call',
						content: JSON.stringify({
							name: SHELL_RESULT_TOOL_NAME,
							args: input,
							callId,
						}),
						agent: args.ctx.agent,
						provider: args.ctx.provider,
						model: args.ctx.model,
						startedAt: now,
						completedAt: now,
						toolName: SHELL_RESULT_TOOL_NAME,
						toolCallId: callId,
					},
					{
						id: crypto.randomUUID(),
						messageId: args.ctx.messageId,
						index: resultIndex,
						stepIndex: args.stepNumber,
						type: 'tool_result',
						content: JSON.stringify({
							name: SHELL_RESULT_TOOL_NAME,
							result: prompt,
							callId,
						}),
						agent: args.ctx.agent,
						provider: args.ctx.provider,
						model: args.ctx.model,
						startedAt: now,
						completedAt: now,
						toolName: SHELL_RESULT_TOOL_NAME,
						toolCallId: callId,
					},
				])
				.run();
		});
		markShellJobsReported(jobIds);
		publishToolCall(args.ctx, {
			name: SHELL_RESULT_TOOL_NAME,
			input,
			callId,
			stepIndex: args.stepNumber,
		});
		publishToolResult(
			args.ctx,
			{
				name: SHELL_RESULT_TOOL_NAME,
				result: prompt,
				callId,
				args: input,
			},
			args.stepNumber,
		);
		return {
			callId,
			messages: buildResultMessages({ callId, jobIds, prompt }),
		};
	} catch (error) {
		releaseClaimedShellJobs(jobIds);
		throw error;
	}
}

/** Injects completed detached shell jobs into the next model step. */
export function withShellResultsPrepareStep(
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
			const persisted = await persistFinishedShellResults({
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
			logger.warn('[shell] failed to inject detached results', {
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
