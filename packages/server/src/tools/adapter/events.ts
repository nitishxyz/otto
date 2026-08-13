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
		index?: number;
	},
): void {
	publish({
		type: 'tool.call',
		sessionId: ctx.sessionId,
		projectRoot: ctx.projectRoot,
		payload: {
			name: args.name,
			args: args.input,
			callId: args.callId,
			stepIndex: args.stepIndex,
			index: args.index,
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
		projectRoot: ctx.projectRoot,
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
		projectRoot: ctx.projectRoot,
		payload: { ...content, stepIndex, messageId: ctx.messageId },
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

type PlanStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type PlanItem = { step: string; status: PlanStatus };

const PLAN_STATUSES = new Set<PlanStatus>([
	'pending',
	'in_progress',
	'completed',
	'cancelled',
]);

function normalizePlanItems(raw: unknown): PlanItem[] | null {
	if (!Array.isArray(raw)) return null;
	const items = raw.flatMap((item): PlanItem[] => {
		if (typeof item === 'string') {
			const step = item.trim();
			return step ? [{ step, status: 'pending' }] : [];
		}
		if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
		const record = item as Record<string, unknown>;
		if (typeof record.step !== 'string') return [];
		const step = record.step.trim();
		if (!step) return [];
		const status = PLAN_STATUSES.has(record.status as PlanStatus)
			? (record.status as PlanStatus)
			: 'pending';
		return [{ step, status }];
	});
	return items.length > 0 ? items : null;
}

function getPlanPayload(result: unknown, input?: unknown) {
	const resultValue =
		result && typeof result === 'object' && !Array.isArray(result)
			? (result as Record<string, unknown>)
			: undefined;
	const resultItems = normalizePlanItems(resultValue?.items);
	if (resultItems) {
		return {
			items: resultItems,
			note:
				typeof resultValue?.note === 'string' ? resultValue.note : undefined,
		};
	}

	const inputValue =
		input && typeof input === 'object' && !Array.isArray(input)
			? (input as Record<string, unknown>)
			: undefined;
	const inputItems = normalizePlanItems(inputValue?.todos);
	if (inputItems) {
		return {
			items: inputItems,
			note: typeof inputValue?.note === 'string' ? inputValue.note : undefined,
		};
	}

	return null;
}

export function publishPlanUpdated(
	ctx: ToolAdapterContext,
	result: unknown,
	input?: unknown,
): void {
	try {
		const payload = getPlanPayload(result, input);
		if (payload) {
			publish({
				type: 'plan.updated',
				sessionId: ctx.sessionId,
				projectRoot: ctx.projectRoot,
				payload,
			});
		}
	} catch {}
}
