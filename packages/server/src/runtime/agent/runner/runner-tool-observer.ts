import { subscribeScopedSessionEvents } from '../../../events/bus.ts';
import type { OttoEvent } from '../../../events/types.ts';
import type { createTurnDumpCollector } from '../../debug/turn-dump.ts';

export type RunnerToolObserverState = {
	toolActivityObserved: boolean;
	trailingAssistantTextAfterTool: boolean;
	endedWithToolActivity: boolean;
	lastToolName?: string;
};

type TurnDumpCollector = NonNullable<
	ReturnType<typeof createTurnDumpCollector>
>;

type ToolEventPayload = {
	name?: string;
	callId?: string;
	messageId?: string;
	args?: unknown;
	result?: unknown;
};

const SYNTHETIC_TOOL_NAMES = new Set(['memory_context']);

function toolPayload(evt: OttoEvent): ToolEventPayload {
	const payload = evt.payload;
	return payload && typeof payload === 'object'
		? (payload as ToolEventPayload)
		: {};
}

/**
 * Observes tool events for one assistant run. Subscribes on the run's project
 * scope and ignores events published for other assistant messages of the same
 * session.
 */
export function observeRunnerToolEvents(args: {
	sessionId: string;
	projectRoot: string;
	messageId?: string;
	dump: TurnDumpCollector | null;
	getStepIndex: () => number;
	onToolCall?: () => void;
}): { state: RunnerToolObserverState; unsubscribe: () => void } {
	const state: RunnerToolObserverState = {
		toolActivityObserved: false,
		trailingAssistantTextAfterTool: false,
		endedWithToolActivity: false,
		lastToolName: undefined,
	};

	const handler = (evt: OttoEvent) => {
		if (evt.type !== 'tool.call' && evt.type !== 'tool.result') return;
		const payload = toolPayload(evt);
		if (payload.name && SYNTHETIC_TOOL_NAMES.has(payload.name)) return;
		if (
			args.messageId &&
			payload.messageId &&
			payload.messageId !== args.messageId
		) {
			return;
		}
		state.toolActivityObserved = true;
		state.trailingAssistantTextAfterTool = false;
		state.endedWithToolActivity = true;
		state.lastToolName = payload.name;

		if (evt.type === 'tool.call') {
			args.onToolCall?.();
			try {
				args.dump?.recordToolCall(
					args.getStepIndex(),
					payload.name ?? '',
					payload.callId ?? '',
					payload.args,
				);
			} catch {}
			return;
		}
		try {
			args.dump?.recordToolResult(
				args.getStepIndex(),
				payload.name ?? '',
				payload.callId ?? '',
				payload.result,
			);
		} catch {}
	};

	let active = true;
	const unsubscribeBus = subscribeScopedSessionEvents(
		args.sessionId,
		handler,
		args.projectRoot,
	);
	const unsubscribe = () => {
		if (!active) return;
		active = false;
		unsubscribeBus();
	};

	return { state, unsubscribe };
}
