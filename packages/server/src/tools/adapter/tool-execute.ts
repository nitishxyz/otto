import type { Tool } from 'ai';
import { logger } from '@ottocode/sdk';
import {
	createToolError,
	normalizeToolOutcome,
	ToolResultDurabilityError,
	type ToolOutcome,
} from '@ottocode/sdk/tools/error';
import type {
	StepExecutionState,
	ToolAdapterContext,
} from '../../runtime/tools/context.ts';
import { createApprovalRequest } from '../../runtime/tools/approval.ts';
import { requestSecureInput } from '../../runtime/tools/secure-input.ts';
import { consumeToolStream, executeBaseTool } from './execution.ts';
import {
	logToolResult,
	publishPlanUpdated,
	publishToolResult,
} from './events.ts';
import {
	computeToolTiming,
	persistToolResultWithIndex,
	updateToolSessionStats,
} from './persistence.ts';
import {
	ensureToolCallRecord,
	extractToolCallId,
	type ToolCallRecord,
	type ToolCallRecords,
} from './pending.ts';
import { prepareToolCall } from './prepare.ts';
import {
	clearToolJournal,
	journalToolIntent,
	journalToolOutcome,
	toolRestartRecovery,
} from './finalization-journal.ts';
import {
	buildToolResultContent,
	createAbortedToolResult,
	createBlockedToolResult,
	createRejectedToolResult,
	createToolExceptionResult,
	createUnjournaledToolResult,
	markToolFailed,
	markToolSucceeded,
	type ToolFailureState,
} from './results.ts';
import { unwrapDoubleWrappedArgs } from './model-output.ts';
import { referenceBrowserScreenshot } from './browser-artifact.ts';
import {
	createToolOutputRedactor,
	getSensitiveInputs,
	redactToolInput,
	suppressesInputDeltas,
} from './sensitive.ts';

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

type ExecuteArgs = {
	base: Tool;
	ctx: ToolAdapterContext;
	records: ToolCallRecords;
	name: string;
	input: ToolExecuteInput;
	options: ToolExecuteOptions;
	stepStates: Map<number, StepExecutionState>;
	failureState: ToolFailureState;
};

function getStepState(
	stepStates: Map<number, StepExecutionState>,
	stepIndex: number | undefined,
): StepExecutionState {
	const stepKey =
		typeof stepIndex === 'number' && Number.isFinite(stepIndex) ? stepIndex : 0;
	let stepState = stepStates.get(stepKey);
	if (!stepState) {
		stepState = {
			chain: Promise.resolve(),
			failed: false,
			failedToolName: undefined,
		};
		stepStates.set(stepKey, stepState);
	}
	return stepState;
}

/**
 * Executes one tool call identified by its SDK `toolCallId`, then finalizes
 * it exactly once. Calls within a step run sequentially.
 */
export async function handleAdaptedToolExecute(
	args: ExecuteArgs,
): Promise<ToolExecuteReturn> {
	const input = unwrapDoubleWrappedArgs(args.input, args.name);
	const record = ensureToolCallRecord(args.records, {
		callId: extractToolCallId(args.options),
		name: args.name,
		stepIndex: args.ctx.stepIndex,
	});
	if (record.execution) return record.execution as Promise<ToolExecuteReturn>;
	if (record.args === undefined) record.args = input;
	const stepIndex = record.stepIndex ?? args.ctx.stepIndex;
	const stepState = getStepState(args.stepStates, stepIndex);

	const run = async (): Promise<ToolExecuteReturn> => {
		const outcome =
			record.outcome ?? (await executeToolCall(args, record, input));
		record.outcome = outcome;
		await finalizeToolCall(args, record, outcome, stepState, stepIndex);
		return outcome.result as ToolExecuteReturn;
	};

	const queued = stepState.chain.catch(() => undefined).then(run);
	record.execution = queued;
	stepState.chain = queued.then(
		() => undefined,
		() => {
			record.execution = undefined;
		},
	);
	return queued;
}

function getAbortSignal(options: unknown): AbortSignal | undefined {
	return (options as { abortSignal?: AbortSignal } | undefined)?.abortSignal;
}

/**
 * Produces the call's typed outcome. Never throws: tool exceptions become
 * `error` outcomes; nothing here persists or publishes results.
 */
async function executeToolCall(
	args: ExecuteArgs,
	record: ToolCallRecord,
	input: unknown,
): Promise<ToolOutcome> {
	const abortSignal = getAbortSignal(args.options);
	let redactOutput = createToolOutputRedactor(args.base, input);
	const aborted = (): ToolOutcome => ({
		status: 'aborted',
		result: createAbortedToolResult(),
	});
	try {
		if (abortSignal?.aborted) return aborted();

		const prepared = await prepareToolCall({
			base: args.base,
			ctx: args.ctx,
			name: args.name,
			input,
		});
		if (prepared.kind === 'invalid') {
			const result = createToolError(prepared.error, 'validation');
			return { status: 'error', result, error: prepared.error };
		}
		if (prepared.kind === 'blocked') {
			return {
				status: 'blocked',
				result: createBlockedToolResult(prepared.reason),
				reason: prepared.reason,
			};
		}

		if (prepared.needsApproval) {
			const approval = createApprovalRequest({
				sessionId: args.ctx.sessionId,
				messageId: args.ctx.messageId,
				callId: record.callId,
				toolName: args.name,
				args: redactToolInput(args.base, prepared.executionArgs),
				projectRoot: args.ctx.projectRoot,
				signal: abortSignal,
			});
			const approved = await approval.promise;
			if (abortSignal?.aborted) return aborted();
			if (!approved) {
				return { status: 'rejected', result: createRejectedToolResult() };
			}
		}

		const executionArgs = await collectSecureInputs(
			args,
			record,
			prepared.executionArgs,
		);
		if (abortSignal?.aborted) return aborted();
		if (executionArgs === null) {
			if (abortSignal?.aborted) return aborted();
			return { status: 'rejected', result: createRejectedToolResult() };
		}
		redactOutput = createToolOutputRedactor(args.base, executionArgs);

		if (!(await journalToolIntent(args.ctx, record))) {
			const result = createUnjournaledToolResult();
			return { status: 'error', result, error: result.error };
		}
		const res = await executeBaseTool(args.ctx, {
			base: args.base,
			name: args.name,
			input: executionArgs as ToolExecuteInput,
			options: args.options,
			callId: record.callId,
		});
		const result =
			res && typeof res === 'object' && Symbol.asyncIterator in res
				? await consumeToolStream(args.ctx, {
						stream: res as AsyncIterable<unknown>,
						name: args.name,
						stepIndex: record.stepIndex ?? args.ctx.stepIndex,
						callId: record.callId,
						suppressDeltas: suppressesInputDeltas(args.base),
					})
				: res;
		return normalizeToolOutcome(redactOutput(result));
	} catch (error) {
		if (abortSignal?.aborted) return aborted();
		const result = redactOutput(createToolExceptionResult(error));
		const outcome = normalizeToolOutcome(result);
		return outcome.status === 'success'
			? {
					status: 'error',
					result,
					error: error instanceof Error ? error.message : String(error),
				}
			: outcome;
	}
}

/**
 * Asks the user for declared secret inputs the model did not supply.
 * Returns null when the user declined or the request timed out.
 */
async function collectSecureInputs(
	args: ExecuteArgs,
	record: ToolCallRecord,
	executionArgs: unknown,
): Promise<unknown | null> {
	const sensitive = getSensitiveInputs(args.base);
	if (!sensitive || !executionArgs || typeof executionArgs !== 'object') {
		return executionArgs;
	}
	let next = executionArgs as Record<string, unknown>;
	for (const entry of sensitive) {
		const secure = entry.secureInput;
		if (!secure || entry.path.includes('.')) continue;
		const current = next[entry.path];
		if (typeof current === 'string' && current.length > 0) continue;
		if (secure.when && !secure.when(next)) continue;
		const value = await requestSecureInput({
			projectRoot: args.ctx.projectRoot,
			sessionId: args.ctx.sessionId,
			messageId: args.ctx.messageId,
			callId: record.callId,
			prompt: secure.prompt,
			inputKind: 'password',
			allowRemember: false,
			signal: getAbortSignal(args.options),
		});
		if (value === null || getAbortSignal(args.options)?.aborted) return null;
		next = { ...next, [entry.path]: value };
	}
	return next;
}

/**
 * Persists, records stats for, and publishes a call's outcome exactly once
 * per call id. Retries only persistence, never execution. The redacted
 * outcome is journaled first so restart recovery can replay it if the DB
 * write fails or the process dies. An exhausted durability barrier rejects
 * the call without publishing a result; the journal record is kept and the
 * failure log states what a restart will recover (`restartRecovery`).
 */
async function finalizeToolCall(
	args: ExecuteArgs,
	record: ToolCallRecord,
	outcome: ToolOutcome,
	stepState: StepExecutionState,
	stepIndex: number | undefined,
): Promise<void> {
	if (record.finalized) return;

	const { ctx, name } = args;
	const succeeded = outcome.status === 'success';
	if (succeeded) markToolSucceeded(stepState, args.failureState, name);
	else markToolFailed(stepState, args.failureState, name);

	const callId = record.callId;
	record.resultPartId ??= crypto.randomUUID();
	record.finalization ??= {
		partId: record.resultPartId,
		...computeToolTiming(record.startTs),
		content: buildToolResultContent({
			name,
			result: outcome.result,
			callId,
			input: redactToolInput(args.base, record.args),
		}),
	};
	record.args = undefined;
	const finalization = record.finalization;
	const { endTs, durationMs, partId, content } = finalization;

	const persist = async () => {
		finalization.index ??= await ctx.nextIndex();
		await persistToolResultWithIndex(ctx, {
			partId,
			index: finalization.index,
			name,
			content,
			startTs: record.startTs,
			callId,
			stepIndex,
			endTs,
			durationMs,
		});
	};
	const logPersistFailure = (error: unknown) => {
		logger.warn('[tool] failed to persist tool result', {
			sessionId: ctx.sessionId,
			messageId: ctx.messageId,
			tool: name,
			callId,
			error: error instanceof Error ? error.message : String(error),
		});
	};

	if (record.journalState !== 'outcome') {
		try {
			finalization.index ??= await ctx.nextIndex();
		} catch {}
		await journalToolOutcome(ctx, record, outcome, finalization);
	}

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await persist();
			break;
		} catch (error) {
			if (attempt === 2) {
				logger.error('[tool] tool result is not durable in the database', {
					sessionId: ctx.sessionId,
					messageId: ctx.messageId,
					tool: name,
					callId,
					restartRecovery: toolRestartRecovery(record),
					error: error instanceof Error ? error.message : String(error),
				});
				throw new ToolResultDurabilityError(callId, name, outcome, error);
			}
		}
	}
	record.finalized = true;
	await clearToolJournal(ctx, record);

	if (succeeded) {
		try {
			await updateToolSessionStats(ctx, { name, durationMs, endTs });
		} catch (error) {
			logPersistFailure(error);
		}
	}

	try {
		const eventContent =
			succeeded && name === 'browser'
				? referenceBrowserScreenshot(content, ctx.sessionId, callId)
				: content;
		publishToolResult(ctx, eventContent, stepIndex);
		if (succeeded) {
			logToolResult(ctx, { name, callId, stepIndex });
			if (name === 'update_todos') {
				publishPlanUpdated(ctx, content.result, content.args);
			}
		}
	} catch (error) {
		logger.warn('[tool] failed to publish tool result', {
			sessionId: ctx.sessionId,
			messageId: ctx.messageId,
			tool: name,
			callId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
