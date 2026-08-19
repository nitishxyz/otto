import { logger } from '@ottocode/sdk';
import type {
	ToolCallPayload,
	ToolDeltaPayload,
	ToolResultPayload,
} from '@ottocode/sdk/events/protocol';
import { publish } from '../../events/bus.ts';
import { boundToolEventValue } from '../../events/tool-payload.ts';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';

const MAX_STREAMED_INPUT_CHARS = 48_000;
const MAX_TOOL_DELTA_CHARS = 24_000;
const MAX_TRACKED_STREAM_INPUTS = 1024;

interface StreamedInputState {
	chars: number;
	omissionPublished: boolean;
}

const streamedInputs = new Map<string, StreamedInputState>();

export type ToolResultContent = {
	name: string;
	result: unknown;
	callId?: string;
	artifact?: unknown;
	args?: unknown;
};

function streamedInputKey(
	ctx: ToolAdapterContext,
	name: string,
	callId?: string,
): string {
	return `${ctx.projectRoot}\u0000${ctx.sessionId}\u0000${ctx.messageId}\u0000${
		callId ?? name
	}`;
}

function clearStreamedInput(
	ctx: ToolAdapterContext,
	name: string,
	callId?: string,
): void {
	streamedInputs.delete(streamedInputKey(ctx, name, callId));
}

function boundPayloadField(
	payload: object,
	field: 'args' | 'result' | 'artifact',
	value: unknown,
): void {
	const bounded = boundToolEventValue(value);
	const target = payload as Record<string, unknown>;
	target[field] = bounded.value;
	if (bounded.truncated) {
		target[`${field}Truncated`] = true;
		target[`${field}OriginalBytes`] = bounded.originalBytes;
	}
}

function withoutDuplicatedArtifact(
	result: unknown,
	artifact: unknown,
): unknown {
	if (
		artifact === undefined ||
		!result ||
		typeof result !== 'object' ||
		Array.isArray(result) ||
		!('artifact' in result)
	) {
		return result;
	}
	const { artifact: _artifact, ...rest } = result as Record<string, unknown>;
	return rest;
}

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
	clearStreamedInput(ctx, args.name, args.callId);
	const payload: ToolCallPayload = {
		name: args.name,
		callId: args.callId,
		stepIndex: args.stepIndex,
		index: args.index,
		messageId: ctx.messageId,
		args: undefined,
	};
	boundPayloadField(payload, 'args', args.input);
	publish({
		type: 'tool.call',
		sessionId: ctx.sessionId,
		projectRoot: ctx.projectRoot,
		payload,
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
	let delta = args.delta;
	let deltaTruncated = false;
	let deltaOriginalBytes: number | undefined;
	if (typeof args.delta === 'string') {
		const originalDelta = args.delta;
		deltaOriginalBytes = Buffer.byteLength(originalDelta, 'utf8');
		if (args.channel === 'input') {
			const key = streamedInputKey(ctx, args.name, args.callId);
			let state = streamedInputs.get(key);
			if (!state) {
				if (streamedInputs.size >= MAX_TRACKED_STREAM_INPUTS) {
					const oldestKey = streamedInputs.keys().next().value;
					if (typeof oldestKey === 'string') streamedInputs.delete(oldestKey);
				}
				state = { chars: 0, omissionPublished: false };
				streamedInputs.set(key, state);
			}
			const remaining = Math.max(0, MAX_STREAMED_INPUT_CHARS - state.chars);
			const allowed = Math.min(remaining, MAX_TOOL_DELTA_CHARS);
			if (originalDelta.length > allowed) deltaTruncated = true;
			const boundedDelta = allowed > 0 ? originalDelta.slice(0, allowed) : '';
			delta = boundedDelta;
			state.chars += boundedDelta.length;
			if (!boundedDelta && state.omissionPublished) return;
			if (deltaTruncated) state.omissionPublished = true;
		} else if (originalDelta.length > MAX_TOOL_DELTA_CHARS) {
			delta = originalDelta.slice(0, MAX_TOOL_DELTA_CHARS);
			deltaTruncated = true;
		}
	} else {
		const bounded = boundToolEventValue(delta);
		delta = bounded.value;
		deltaTruncated = bounded.truncated;
		deltaOriginalBytes = bounded.originalBytes;
	}
	const payload: ToolDeltaPayload = {
		name: args.name,
		channel: args.channel,
		delta,
		stepIndex: args.stepIndex,
		callId: args.callId,
		messageId: ctx.messageId,
	};
	if (deltaTruncated) {
		payload.deltaTruncated = true;
		payload.deltaOriginalBytes = deltaOriginalBytes;
	}
	publish({
		type: 'tool.delta',
		sessionId: ctx.sessionId,
		projectRoot: ctx.projectRoot,
		payload,
	});
}

export function publishToolResult(
	ctx: ToolAdapterContext,
	content: ToolResultContent,
	stepIndex?: number,
): void {
	clearStreamedInput(ctx, content.name, content.callId);
	const payload: ToolResultPayload = {
		name: content.name,
		callId: content.callId,
		stepIndex,
		messageId: ctx.messageId,
		result: undefined,
	};
	boundPayloadField(
		payload,
		'result',
		withoutDuplicatedArtifact(content.result, content.artifact),
	);
	if (content.args !== undefined) {
		boundPayloadField(payload, 'args', content.args);
	}
	if (content.artifact !== undefined) {
		boundPayloadField(payload, 'artifact', content.artifact);
	}
	publish({
		type: 'tool.result',
		sessionId: ctx.sessionId,
		projectRoot: ctx.projectRoot,
		payload,
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
