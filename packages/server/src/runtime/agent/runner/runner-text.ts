import { messageParts } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { publish } from '../../../events/bus.ts';
import type { getDb } from '@ottocode/database';
import type { RunOpts } from '../../session/queue.ts';
import type { ToolAdapterContext } from '../../../tools/adapter.ts';
import type { createTurnDumpCollector } from '../../debug/turn-dump.ts';
import {
	flushPartContentWrites,
	queuePartContentWrite,
} from '../../persistence/part-content-writer.ts';
import type { RunnerToolObserverState } from './runner-tool-observer.ts';
import { nowMs } from './runner-telemetry.ts';

type TurnDumpCollector = NonNullable<
	ReturnType<typeof createTurnDumpCollector>
>;

export type RunnerTextState = {
	currentPartId: string | null;
	accumulated: string;
	latestAssistantText: string;
	lastTextDeltaStepIndex: number | null;
	firstPublishedDeltaSeen: boolean;
};

/**
 * Durability barrier for streamed part content. Queues the latest accumulated
 * text (if any) and waits until every queued part-content write - text and
 * reasoning - is on disk. Call at step finish, abort, and error.
 */
export async function flushRunnerTextPart(
	state: RunnerTextState,
	db: Awaited<ReturnType<typeof getDb>>,
): Promise<void> {
	if (state.currentPartId) {
		queuePartContentWrite(
			db,
			state.currentPartId,
			JSON.stringify({ text: state.accumulated }),
		);
	}
	await flushPartContentWrites();
}

export async function handleRunnerTextDelta(args: {
	delta: string;
	state: RunnerTextState;
	toolObserver: RunnerToolObserverState;
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	sharedCtx: ToolAdapterContext;
	stepIndex: number;
	dump: TurnDumpCollector | null;
	firstToolSeen: () => boolean;
	logFirstOutputLatency: (kind: 'text' | 'reasoning') => void;
	runStartedAt: number;
	queueWaitMs: number;
	setupMs: number;
}): Promise<boolean> {
	const { delta, state, opts, db, sharedCtx, stepIndex, dump } = args;
	state.accumulated += delta;
	if (state.accumulated.trim()) {
		state.latestAssistantText = state.accumulated;
	}
	if (state.accumulated.length > 0) {
		state.lastTextDeltaStepIndex = stepIndex;
	}
	dump?.recordTextDelta(stepIndex, state.accumulated);
	if (
		(delta.trim().length > 0 && args.toolObserver.toolActivityObserved) ||
		(delta.trim().length > 0 && args.firstToolSeen())
	) {
		args.toolObserver.trailingAssistantTextAfterTool = true;
		args.toolObserver.endedWithToolActivity = false;
	}

	if (!state.currentPartId && !state.accumulated.trim()) {
		return false;
	}

	args.logFirstOutputLatency('text');

	if (!state.currentPartId) {
		state.currentPartId = crypto.randomUUID();
		sharedCtx.assistantPartId = state.currentPartId;
		await db.insert(messageParts).values({
			id: state.currentPartId,
			messageId: opts.assistantMessageId,
			index: await sharedCtx.nextIndex(),
			stepIndex: null,
			type: 'text',
			content: JSON.stringify({ text: state.accumulated }),
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			startedAt: Date.now(),
		});
	}

	publish({
		type: 'message.part.delta',
		sessionId: opts.sessionId,
		projectId: opts.projectId,
		projectRoot: opts.projectRoot,
		payload: {
			messageId: opts.assistantMessageId,
			partId: state.currentPartId,
			stepIndex,
			delta,
		},
	});
	if (!state.firstPublishedDeltaSeen) {
		state.firstPublishedDeltaSeen = true;
		logger.info('[latency] first published delta', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			sinceRunStartMs: nowMs() - args.runStartedAt,
			queueWaitMs: args.queueWaitMs,
			setupMs: args.setupMs,
			deltaPreview: delta.length > 80 ? `${delta.slice(0, 80)}…` : delta,
		});
	}
	queuePartContentWrite(
		db,
		state.currentPartId,
		JSON.stringify({ text: state.accumulated }),
	);
	return true;
}
