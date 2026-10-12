import type { Tool } from 'ai';
import { logger } from '@ottocode/sdk';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';
import { logToolCall, publishToolCall, publishToolDelta } from './events.ts';
import { persistToolCall } from './persistence.ts';
import {
	ensureToolCallRecord,
	extractToolCallId,
	type ToolCallRecords,
} from './pending.ts';
import { redactToolInput, suppressesInputDeltas } from './sensitive.ts';
import { unwrapDoubleWrappedArgs } from './model-output.ts';

type InputHandlerArgs = {
	base: Tool;
	ctx: ToolAdapterContext;
	records: ToolCallRecords;
	name: string;
	options: unknown;
};

type InputAvailableArgs = InputHandlerArgs & {
	markFirstToolCallReported: () => boolean;
};

function recordFor(args: InputHandlerArgs) {
	return ensureToolCallRecord(args.records, {
		callId: extractToolCallId(args.options),
		name: args.name,
		stepIndex: args.ctx.stepIndex,
	});
}

async function callBaseInputHook(
	base: Tool,
	hook: 'onInputStart' | 'onInputDelta' | 'onInputAvailable',
	options: unknown,
) {
	if (typeof base[hook] !== 'function') return;
	// biome-ignore lint/suspicious/noExplicitAny: AI SDK tool hook types are complex
	await base[hook](options as any);
}

export async function handleAdaptedToolInputStart(args: InputHandlerArgs) {
	recordFor(args);
	await callBaseInputHook(args.base, 'onInputStart', args.options);
}

export async function handleAdaptedToolInputDelta(args: InputHandlerArgs) {
	const delta = (args.options as { inputTextDelta?: string } | undefined)
		?.inputTextDelta;
	const record = recordFor(args);
	if (record.finalized) return;
	if (!suppressesInputDeltas(args.base)) {
		publishToolDelta(args.ctx, {
			name: args.name,
			channel: 'input',
			delta,
			stepIndex: record.stepIndex ?? args.ctx.stepIndex,
			callId: record.callId,
		});
		record.hasPublishedDelta = true;
	}
	await callBaseInputHook(args.base, 'onInputDelta', args.options);
}

/**
 * Records the complete input for this call id and announces the call.
 * Policy (path resolution, guards, approval) runs at execution time on the
 * resolved arguments; see `prepareToolCall`.
 */
export async function handleAdaptedToolInputAvailable(
	args: InputAvailableArgs,
) {
	const input = unwrapDoubleWrappedArgs(
		(args.options as { input?: unknown } | undefined)?.input,
		args.name,
	);
	const record = recordFor(args);
	if (record.inputAvailable || record.finalized) return;
	record.inputAvailable = true;
	record.stepIndex = args.ctx.stepIndex;
	record.args = input;

	const callId = record.callId;
	const callPartId = crypto.randomUUID();
	const safeInput = redactToolInput(args.base, input);

	if (
		args.markFirstToolCallReported() &&
		typeof args.ctx.onFirstToolCall === 'function'
	) {
		try {
			args.ctx.onFirstToolCall();
		} catch (error) {
			logger.debug('[tool] onFirstToolCall callback failed', {
				sessionId: args.ctx.sessionId,
				messageId: args.ctx.messageId,
				tool: args.name,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	let index: number | undefined;
	try {
		index = await persistToolCall(args.ctx, {
			partId: callPartId,
			name: args.name,
			input: safeInput,
			callId,
			startTs: record.startTs,
			stepIndex: args.ctx.stepIndex,
		});
	} catch (error) {
		logger.debug(
			args.name === 'progress_update'
				? '[tool] failed to persist progress_update call'
				: '[tool] failed to persist tool call',
			{
				sessionId: args.ctx.sessionId,
				messageId: args.ctx.messageId,
				tool: args.name,
				callId,
				error: error instanceof Error ? error.message : String(error),
			},
		);
	}
	publishToolCall(args.ctx, {
		name: args.name,
		input: safeInput,
		callId,
		stepIndex: args.ctx.stepIndex,
		index,
	});
	if (args.name === 'progress_update') {
		logToolCall(args.ctx, {
			name: args.name,
			callId,
			stepIndex: args.ctx.stepIndex,
		});
	}

	await callBaseInputHook(args.base, 'onInputAvailable', args.options);
}
