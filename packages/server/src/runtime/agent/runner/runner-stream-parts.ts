import { logger } from '@ottocode/sdk';
import type { getDb } from '@ottocode/database';
import { publish } from '../../../events/bus.ts';
import type { ToolAdapterContext } from '../../../tools/adapter.ts';
import type { createTurnDumpCollector } from '../../debug/turn-dump.ts';
import type { RunOpts } from '../../session/queue.ts';
import type { createOauthCodexTextGuardState } from '../../stream/text-guard.ts';
import {
	consumeOauthCodexTextDelta,
	resetOauthCodexTextGuard,
} from '../../stream/text-guard.ts';
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

function deltaTextField(record: StreamPartRecord): string {
	return stringField(record, 'text') || stringField(record, 'delta');
}

function createAbortError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	const error = new Error(
		typeof signal.reason === 'string' ? signal.reason : 'Operation aborted',
	);
	error.name = 'AbortError';
	return error;
}

function cancelIterator(iterator: AsyncIterator<unknown>) {
	try {
		const returned = iterator.return?.();
		if (returned) void Promise.resolve(returned).catch(() => undefined);
	} catch {}
}

function nextStreamPart(
	iterator: AsyncIterator<unknown>,
	signal?: AbortSignal,
): Promise<IteratorResult<unknown>> {
	if (!signal) return iterator.next();
	if (signal.aborted) return Promise.reject(createAbortError(signal));

	return new Promise((resolve, reject) => {
		const onAbort = () => reject(createAbortError(signal));
		signal.addEventListener('abort', onAbort, { once: true });
		iterator
			.next()
			.then(resolve, reject)
			.finally(() => signal.removeEventListener('abort', onAbort));
	});
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
	const iterator = args.fullStream[Symbol.asyncIterator]();

	while (true) {
		let next: IteratorResult<unknown>;
		try {
			next = await nextStreamPart(iterator, args.opts.abortSignal);
		} catch (error) {
			if (args.opts.abortSignal?.aborted) {
				cancelIterator(iterator);
			}
			throw error;
		}
		if (next.done) break;

		const rawPart = next.value;
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
				// A structured tool part ends any pseudo tool-call text leak; reset
				// the guard window so post-tool prose is not dropped for the rest
				// of the run.
				if (args.oauthTextGuard) resetOauthCodexTextGuard(args.oauthTextGuard);
				break;
			case 'text-delta': {
				const rawDelta = deltaTextField(part);
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
				const text = deltaTextField(part);
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
			projectId: args.opts.projectId,
			projectRoot: args.opts.projectRoot,
			payload: { reason: 'no-tool-calls' },
		});
	}
}
