import type { Tool } from 'ai';
import { getToolMetadata, logger } from '@ottocode/sdk';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';
import {
	requiresApproval,
	requestApproval,
	skipsGuardApproval,
} from '../../runtime/tools/approval.ts';
import { guardToolCall } from '../../runtime/tools/guards.ts';
import { logToolCall, publishToolCall, publishToolDelta } from './events.ts';
import { persistToolCall } from './persistence.ts';
import {
	extractToolCallId,
	getPendingQueue,
	type PendingCallMeta,
} from './pending.ts';

type InputHandlerArgs = {
	base: Tool;
	ctx: ToolAdapterContext;
	pendingCalls: Map<string, PendingCallMeta[]>;
	name: string;
	options: unknown;
};

type InputAvailableArgs = InputHandlerArgs & {
	markFirstToolCallReported: () => boolean;
};

function resolvePendingMeta(args: InputHandlerArgs): PendingCallMeta {
	const sdkCallId = extractToolCallId(args.options);
	const queue = getPendingQueue(args.pendingCalls, args.name);
	let meta = queue.length ? queue[queue.length - 1] : undefined;
	if (!meta) {
		meta = {
			callId: sdkCallId || crypto.randomUUID(),
			startTs: Date.now(),
			stepIndex: args.ctx.stepIndex,
		};
		queue.push(meta);
	}
	if (sdkCallId && meta.callId !== sdkCallId && !meta.hasPublishedDelta) {
		meta.callId = sdkCallId;
	}
	return meta;
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
	const sdkCallId = extractToolCallId(args.options);
	const queue = getPendingQueue(args.pendingCalls, args.name);
	queue.push({
		callId: sdkCallId || crypto.randomUUID(),
		startTs: Date.now(),
		stepIndex: args.ctx.stepIndex,
	});
	await callBaseInputHook(args.base, 'onInputStart', args.options);
}

export async function handleAdaptedToolInputDelta(args: InputHandlerArgs) {
	const delta = (args.options as { inputTextDelta?: string } | undefined)
		?.inputTextDelta;
	const meta = resolvePendingMeta(args);
	publishToolDelta(args.ctx, {
		name: args.name,
		channel: 'input',
		delta,
		stepIndex: meta.stepIndex ?? args.ctx.stepIndex,
		callId: meta.callId,
	});
	meta.hasPublishedDelta = true;
	await callBaseInputHook(args.base, 'onInputDelta', args.options);
}

export async function handleAdaptedToolInputAvailable(
	args: InputAvailableArgs,
) {
	const input = (args.options as { input?: unknown } | undefined)?.input;
	const meta = resolvePendingMeta(args);
	meta.stepIndex = args.ctx.stepIndex;
	meta.args = input;

	const callId = meta.callId;
	const callPartId = crypto.randomUUID();
	const startTs = meta.startTs;

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
			input,
			callId,
			startTs,
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
		input,
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

	if (args.name !== 'progress_update') {
		if (
			args.ctx.toolApprovalMode &&
			requiresApproval(
				args.name,
				args.ctx.toolApprovalMode,
				input,
				getToolMetadata(args.base)?.effects,
			)
		) {
			meta.approvalPromise = requestApproval(
				args.ctx.sessionId,
				args.ctx.messageId,
				callId,
				args.name,
				input,
				undefined,
				args.ctx.projectRoot,
			);
		}
		const guard = guardToolCall(args.name, input, {
			projectRoot: args.ctx.projectRoot,
			readOnlyRoots: args.ctx.readOnlyRoots,
		});
		if (guard.type === 'block') {
			meta.blocked = true;
			meta.blockReason = guard.reason;
		} else if (
			guard.type === 'approve' &&
			!meta.approvalPromise &&
			!skipsGuardApproval(args.ctx.toolApprovalMode)
		) {
			meta.approvalPromise = requestApproval(
				args.ctx.sessionId,
				args.ctx.messageId,
				callId,
				args.name,
				input,
				undefined,
				args.ctx.projectRoot,
			);
		}
	}

	await callBaseInputHook(args.base, 'onInputAvailable', args.options);
}
