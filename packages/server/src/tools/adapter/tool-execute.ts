import type { Tool } from 'ai';
import { logger } from '@ottocode/sdk';
import { isToolError } from '@ottocode/sdk/tools/error';
import type {
	StepExecutionState,
	ToolAdapterContext,
} from '../../runtime/tools/context.ts';
import { consumeToolStream, executeBaseTool } from './execution.ts';
import {
	logToolResult,
	publishPlanUpdated,
	publishToolResult,
} from './events.ts';
import {
	computeToolTiming,
	persistToolErrorResult,
	persistToolResultWithIndex,
	updateToolSessionStats,
} from './persistence.ts';
import {
	extractToolCallId,
	shiftPendingCall,
	type PendingCallMeta,
} from './pending.ts';
import {
	buildToolResultContent,
	createAbortedToolResult,
	createBlockedToolResult,
	createRejectedToolResult,
	createToolExceptionResult,
	markToolFailed,
	markToolSucceeded,
	type ToolFailureState,
} from './results.ts';
import { unwrapDoubleWrappedArgs } from './model-output.ts';

type ToolExecuteSignature = Tool['execute'] extends (
	input: infer Input,
	options: infer Options,
) => infer Result
	? { input: Input; options: Options; result: Result }
	: { input: unknown; options: unknown; result: unknown };
export type ToolExecuteInput = ToolExecuteSignature['input'];
export type ToolExecuteOptions = ToolExecuteSignature['options'] extends never
	? undefined
	: ToolExecuteSignature['options'];
type ToolExecuteReturn = ToolExecuteSignature['result'];

export async function handleAdaptedToolExecute(args: {
	base: Tool;
	ctx: ToolAdapterContext;
	pendingCalls: Map<string, PendingCallMeta[]>;
	name: string;
	input: ToolExecuteInput;
	options: ToolExecuteOptions;
	stepStates: Map<number, StepExecutionState>;
	failureState: ToolFailureState;
	processedToolErrors: WeakSet<object>;
}): Promise<ToolExecuteReturn> {
	const input = unwrapDoubleWrappedArgs(args.input, args.name);
	const sdkCallId = extractToolCallId(args.options);
	const abortSignal = (
		args.options as { abortSignal?: AbortSignal } | undefined
	)?.abortSignal;
	const meta = shiftPendingCall(args.pendingCalls, args.name);
	const callIdFromQueue = sdkCallId || meta?.callId;
	const startTsFromQueue = meta?.startTs;
	const stepIndexForEvent = meta?.stepIndex ?? args.ctx.stepIndex;

	const stepKey =
		typeof stepIndexForEvent === 'number' && Number.isFinite(stepIndexForEvent)
			? stepIndexForEvent
			: 0;
	let stepState = args.stepStates.get(stepKey);
	if (!stepState) {
		stepState = {
			chain: Promise.resolve(),
			failed: false,
			failedToolName: undefined,
		};
		args.stepStates.set(stepKey, stepState);
	}

	const executeWithGuards = async (): Promise<ToolExecuteReturn> => {
		try {
			if (abortSignal?.aborted) {
				const abortedResult = createAbortedToolResult();
				await persistToolErrorResult(args.ctx, {
					name: args.name,
					errorResult: abortedResult,
					callId: callIdFromQueue,
					startTs: startTsFromQueue,
					stepIndexForEvent,
					input: meta?.args,
				});
				return abortedResult as ToolExecuteReturn;
			}

			if (meta?.blocked) {
				const blockedResult = createBlockedToolResult(meta.blockReason);
				await persistToolErrorResult(args.ctx, {
					name: args.name,
					errorResult: blockedResult,
					callId: callIdFromQueue,
					startTs: startTsFromQueue,
					stepIndexForEvent,
					input: meta?.args,
				});
				return blockedResult as ToolExecuteReturn;
			}

			if (meta?.approvalPromise) {
				const approved = await meta.approvalPromise;
				if (abortSignal?.aborted) {
					const abortedResult = createAbortedToolResult();
					await persistToolErrorResult(args.ctx, {
						name: args.name,
						errorResult: abortedResult,
						callId: callIdFromQueue,
						startTs: startTsFromQueue,
						stepIndexForEvent,
						input: meta?.args,
					});
					return abortedResult as ToolExecuteReturn;
				}
				if (!approved) {
					const rejectedResult = createRejectedToolResult();
					await persistToolErrorResult(args.ctx, {
						name: args.name,
						errorResult: rejectedResult,
						callId: callIdFromQueue,
						startTs: startTsFromQueue,
						stepIndexForEvent,
						input: meta?.args,
					});
					return rejectedResult as ToolExecuteReturn;
				}
			}

			const res = executeBaseTool(args.ctx, {
				base: args.base,
				name: args.name,
				input,
				options: args.options,
				callId: callIdFromQueue,
			});
			let result: unknown = res;
			if (res && typeof res === 'object' && Symbol.asyncIterator in res) {
				result = await consumeToolStream(args.ctx, {
					stream: res as AsyncIterable<unknown>,
					name: args.name,
					stepIndex: stepIndexForEvent,
					callId: callIdFromQueue,
				});
			} else {
				result = await Promise.resolve(res as ToolExecuteReturn);
			}

			if (isToolError(result)) {
				markToolFailed(stepState, args.failureState, args.name);
				await persistToolErrorResult(args.ctx, {
					name: args.name,
					errorResult: result,
					callId: callIdFromQueue,
					startTs: startTsFromQueue,
					stepIndexForEvent,
					input: meta?.args,
				});
				args.processedToolErrors.add(result as object);
				return result as ToolExecuteReturn;
			}

			const resultPartId = crypto.randomUUID();
			const callId = callIdFromQueue;
			const startTs = startTsFromQueue;
			const contentObj = buildToolResultContent({
				name: args.name,
				result,
				callId,
				input: meta?.args,
			});

			const index = await args.ctx.nextIndex();
			const { endTs, durationMs } = computeToolTiming(startTs);

			if (args.name === 'progress_update') {
				markToolSucceeded(stepState, args.failureState, args.name);
				publishToolResult(args.ctx, contentObj, stepIndexForEvent);
				void persistProgressUpdateResult({
					ctx: args.ctx,
					partId: resultPartId,
					index,
					name: args.name,
					content: contentObj,
					startTs,
					callId,
					stepIndex: stepIndexForEvent,
					endTs,
					durationMs,
				});
				return result as ToolExecuteReturn;
			}

			markToolSucceeded(stepState, args.failureState, args.name);
			await persistToolResultWithIndex(args.ctx, {
				partId: resultPartId,
				index,
				name: args.name,
				content: contentObj,
				startTs,
				callId,
				stepIndex: stepIndexForEvent,
				endTs,
				durationMs,
			});
			await updateToolSessionStats(args.ctx, {
				name: args.name,
				durationMs,
				endTs,
			});
			publishToolResult(args.ctx, contentObj, stepIndexForEvent);
			logToolResult(args.ctx, {
				name: args.name,
				callId,
				stepIndex: stepIndexForEvent,
			});
			if (args.name === 'update_todos') {
				publishPlanUpdated(args.ctx, contentObj.result, contentObj.args);
			}
			return result as ToolExecuteReturn;
		} catch (error) {
			markToolFailed(stepState, args.failureState, args.name);

			if (isToolError(error) && args.processedToolErrors.has(error as object)) {
				throw error;
			}

			const errorResult = isToolError(error)
				? error
				: createToolExceptionResult(error);

			await persistToolErrorResult(args.ctx, {
				name: args.name,
				errorResult,
				callId: callIdFromQueue,
				startTs: startTsFromQueue,
				stepIndexForEvent,
				input: meta?.args,
			});

			if (isToolError(error)) {
				args.processedToolErrors.add(error as object);
			}

			return errorResult as ToolExecuteReturn;
		}
	};

	const queued = stepState.chain
		.catch(() => undefined)
		.then(() => executeWithGuards());
	stepState.chain = queued.then(
		() => undefined,
		() => undefined,
	);
	return queued;
}

async function persistProgressUpdateResult(args: {
	ctx: ToolAdapterContext;
	partId: string;
	index: number;
	name: string;
	content: ReturnType<typeof buildToolResultContent>;
	startTs: number | undefined;
	callId: string | undefined;
	stepIndex: number | undefined;
	endTs: number;
	durationMs: number | null;
}) {
	try {
		await persistToolResultWithIndex(args.ctx, {
			partId: args.partId,
			index: args.index,
			name: args.name,
			content: args.content,
			startTs: args.startTs,
			callId: args.callId,
			stepIndex: args.stepIndex,
			endTs: args.endTs,
			durationMs: args.durationMs,
		});
	} catch (error) {
		logger.debug('[tool] failed to persist progress_update result', {
			sessionId: args.ctx.sessionId,
			messageId: args.ctx.messageId,
			callId: args.callId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
