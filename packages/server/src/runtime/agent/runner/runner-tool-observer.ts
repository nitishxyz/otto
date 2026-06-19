import { subscribe } from '../../../events/bus.ts';
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

export function observeRunnerToolEvents(args: {
	sessionId: string;
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

	const unsubscribe = subscribe(args.sessionId, (evt: OttoEvent) => {
		if (evt.type === 'tool.call' || evt.type === 'tool.result') {
			state.toolActivityObserved = true;
			state.trailingAssistantTextAfterTool = false;
			state.endedWithToolActivity = true;
			try {
				state.lastToolName = (
					evt.payload as { name?: string } | undefined
				)?.name;
			} catch {
				state.lastToolName = undefined;
			}
		}
		if (evt.type === 'tool.call') {
			args.onToolCall?.();
			if (args.dump) {
				try {
					const p = evt.payload as {
						name?: string;
						callId?: string;
						args?: unknown;
					};
					args.dump.recordToolCall(
						args.getStepIndex(),
						p.name ?? '',
						p.callId ?? '',
						p.args,
					);
				} catch {}
			}
		}
		if (evt.type === 'tool.result') {
			if (args.dump) {
				try {
					const p = evt.payload as {
						name?: string;
						callId?: string;
						result?: unknown;
					};
					args.dump.recordToolResult(
						args.getStepIndex(),
						p.name ?? '',
						p.callId ?? '',
						p.result,
					);
				} catch {}
			}
		}
	});

	return { state, unsubscribe };
}
