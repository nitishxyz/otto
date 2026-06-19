import { logger } from '@ottocode/sdk';
import type { getDb } from '@ottocode/database';
import { publish } from '../../../events/bus.ts';
import type { ToolAdapterContext } from '../../../tools/adapter.ts';
import type { createTurnDumpCollector } from '../../debug/turn-dump.ts';
import type { RunOpts } from '../../session/queue.ts';
import type { createOauthCodexTextGuardState } from '../../stream/text-guard.ts';
import { consumeOauthCodexTextDelta } from '../../stream/text-guard.ts';
import {
	handleReasoningDelta,
	handleReasoningEnd,
	handleReasoningStart,
	type ReasoningState,
} from './runner-reasoning.ts';
import { handleRunnerTextDelta, type RunnerTextState } from './runner-text.ts';
import type { RunnerToolObserverState } from './runner-tool-observer.ts';
import { nowMs } from './runner-telemetry.ts';

type TurnDumpCollector = NonNullable<
	ReturnType<typeof createTurnDumpCollector>
>;

type StreamPartRecord = Record<string, unknown> & { type: string };

type OauthTextGuardState = ReturnType<typeof createOauthCodexTextGuardState>;

function asStreamPartRecord(value: unknown): StreamPartRecord | null {
	if (!value || typeof value !== 'object') return null;
	const type = (value as { type?: unknown }).type;
	if (typeof type !== 'string') return null;
	return value as StreamPartRecord;
}

function stringField(record: StreamPartRecord, field: string): string {
	const value = record[field];
	return typeof value === 'string' ? value : '';
}

export async function consumeRunnerStreamParts(args: {
	fullStream: AsyncIterable<unknown>;
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	sharedCtx: ToolAdapterContext;
	textState: RunnerTextState;
	toolObserver: RunnerToolObserverState;
	reasoningStates: Map<string, ReasoningState>;
	oauthTextGuard: OauthTextGuardState | null;
	getStepIndex: () => number;
	firstToolSeen: () => boolean;
	logFirstOutputLatency: (kind: 'text' | 'reasoning') => void;
	runStartedAt: number;
	queueWaitMs: number;
	setupMs: number;
	dump: TurnDumpCollector | null;
}) {
	let firstFullStreamPartSeen = false;

	for await (const rawPart of args.fullStream) {
		const part = asStreamPartRecord(rawPart);
		if (!part) continue;

		if (!firstFullStreamPartSeen) {
			firstFullStreamPartSeen = true;
			logger.info('[latency] first fullStream part', {
				sessionId: args.opts.sessionId,
				messageId: args.opts.assistantMessageId,
				agent: args.opts.agent,
				provider: args.opts.provider,
				model: args.opts.model,
				partType: part.type,
				sinceRunStartMs: nowMs() - args.runStartedAt,
				queueWaitMs: args.queueWaitMs,
				setupMs: args.setupMs,
			});
		}

		switch (part.type) {
			case 'tool-input-start':
			case 'tool-input-delta':
			case 'tool-input-end':
			case 'tool-call':
			case 'tool-result':
				break;
			case 'text-delta': {
				const rawDelta = stringField(part, 'text');
				if (!rawDelta) break;

				const delta = args.oauthTextGuard
					? consumeOauthCodexTextDelta(args.oauthTextGuard, rawDelta)
					: rawDelta;
				if (!delta) break;

				await handleRunnerTextDelta({
					delta,
					state: args.textState,
					toolObserver: args.toolObserver,
					opts: args.opts,
					db: args.db,
					sharedCtx: args.sharedCtx,
					stepIndex: args.getStepIndex(),
					dump: args.dump,
					firstToolSeen: args.firstToolSeen,
					logFirstOutputLatency: args.logFirstOutputLatency,
					runStartedAt: args.runStartedAt,
					queueWaitMs: args.queueWaitMs,
					setupMs: args.setupMs,
				});
				break;
			}
			case 'reasoning-start': {
				const reasoningId = stringField(part, 'id');
				if (!reasoningId) break;
				await handleReasoningStart(
					reasoningId,
					part.providerMetadata,
					args.opts,
					args.db,
					args.sharedCtx,
					args.getStepIndex,
					args.reasoningStates,
				);
				break;
			}
			case 'reasoning-delta': {
				const reasoningId = stringField(part, 'id');
				if (!reasoningId) break;
				const text = stringField(part, 'text');
				if (text) args.logFirstOutputLatency('reasoning');
				await handleReasoningDelta(
					reasoningId,
					text,
					part.providerMetadata,
					args.opts,
					args.db,
					args.sharedCtx,
					args.getStepIndex,
					args.reasoningStates,
				);
				break;
			}
			case 'reasoning-end': {
				const reasoningId = stringField(part, 'id');
				if (!reasoningId) break;
				await handleReasoningEnd(reasoningId, args.db, args.reasoningStates);
				break;
			}
		}
	}

	if (!args.firstToolSeen()) {
		publish({
			type: 'finish-step',
			sessionId: args.opts.sessionId,
			payload: { reason: 'no-tool-calls' },
		});
	}
}
