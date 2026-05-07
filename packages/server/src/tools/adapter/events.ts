import { logger } from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';

export type ToolResultContent = {
	name: string;
	result: unknown;
	callId?: string;
	artifact?: unknown;
	args?: unknown;
};

export function publishToolCall(
	ctx: ToolAdapterContext,
	args: {
		name: string;
		input: unknown;
		callId: string;
		stepIndex?: number;
	},
): void {
	publish({
		type: 'tool.call',
		sessionId: ctx.sessionId,
		payload: {
			name: args.name,
			args: args.input,
			callId: args.callId,
			stepIndex: args.stepIndex,
			messageId: ctx.messageId,
		},
	});
}

export function logToolCall(
	ctx: ToolAdapterContext,
	args: { name: string; callId?: string; stepIndex?: number },
): void {
	logger.debug(`[tools] call ${args.name}`, {
		sessionId: ctx.sessionId,
		messageId: ctx.messageId,
		toolName: args.name,
		callId: args.callId,
		stepIndex: args.stepIndex,
	});
}

export function publishToolDelta(
	ctx: ToolAdapterContext,
	args: {
		name: string;
		channel: string;
		delta: unknown;
		stepIndex?: number;
		callId?: string;
	},
): void {
	publish({
		type: 'tool.delta',
		sessionId: ctx.sessionId,
		payload: {
			name: args.name,
			channel: args.channel,
			delta: args.delta,
			stepIndex: args.stepIndex,
			callId: args.callId,
			messageId: ctx.messageId,
		},
	});
}

export function publishToolResult(
	ctx: ToolAdapterContext,
	content: ToolResultContent,
	stepIndex?: number,
): void {
	publish({
		type: 'tool.result',
		sessionId: ctx.sessionId,
		payload: { ...content, stepIndex },
	});
}

export function logToolResult(
	ctx: ToolAdapterContext,
	args: { name: string; callId?: string; stepIndex?: number },
): void {
	logger.debug(`[tools] result ${args.name}`, {
		sessionId: ctx.sessionId,
		messageId: ctx.messageId,
		toolName: args.name,
		callId: args.callId,
		stepIndex: args.stepIndex,
	});
}

export function publishPlanUpdated(
	ctx: ToolAdapterContext,
	result: unknown,
): void {
	try {
		const resultValue = result as
			| { items?: unknown; note?: unknown }
			| undefined;
		if (resultValue && Array.isArray(resultValue.items)) {
			publish({
				type: 'plan.updated',
				sessionId: ctx.sessionId,
				payload: {
					items: resultValue.items,
					note: resultValue.note,
				},
			});
		}
	} catch {}
}
