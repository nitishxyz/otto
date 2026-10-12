import { createJudge, logger, type loadConfig } from '@ottocode/sdk';
import type { getDb } from '@ottocode/database';
import { openMemory } from '@ottocode/sdk/memory';
import type { MemoryResult } from '@ottocode/sdk/memory';
import {
	captureCandidates,
	captureUserMemory,
} from '@ottocode/sdk/memory/capture';
import type { RunOpts } from '../../session/queue.ts';
import {
	persistMemoryTurnContext,
	type MemoryTurnContext,
} from '../runner/runner-memory-context.ts';
import { loadTurnMemories } from '../runner/runner-memory-load.ts';
import type {
	classifyMemoryTurn,
	memoryTurnPolicy,
} from '../runner/runner-memory-policy.ts';
import { raceAbort, throwIfRunAborted } from './abort.ts';

type MemoryKind = ReturnType<typeof classifyMemoryTurn>;
type MemoryPolicy = ReturnType<typeof memoryTurnPolicy>;

/**
 * Captures and recalls memory for the current turn, appending any recalled
 * context to `additionalSystemMessages` and persisting the synthetic memory
 * context part. Memory failures never fail the run; cancellation does.
 */
export async function prepareTurnMemory(args: {
	opts: RunOpts;
	cfg: Awaited<ReturnType<typeof loadConfig>>;
	db: Awaited<ReturnType<typeof getDb>>;
	memoryKind: MemoryKind;
	memoryQuery: string;
	memoryPolicy: MemoryPolicy;
	currentParentSessionId: string | null;
	additionalSystemMessages: Array<{ role: 'system' | 'user'; content: string }>;
}): Promise<void> {
	const { opts, cfg, db, memoryKind, memoryQuery, memoryPolicy } = args;
	const signal = opts.abortSignal;
	const isCompactWithContext = Boolean(
		opts.isCompactCommand && opts.compactionContext,
	);

	if (
		cfg.memory?.enabled === false ||
		isCompactWithContext ||
		!opts.userContent?.trim()
	) {
		if (
			opts.userContent?.trim() &&
			memoryKind === 'human' &&
			!isCompactWithContext
		) {
			await persistMemoryTurnContext(db, opts, {
				capture: { candidates: [], results: [], reason: 'disabled' },
			});
		}
		return;
	}

	const canCapture = memoryPolicy.capture;
	const canRecall = memoryPolicy.recall;
	if (!canCapture && !canRecall && memoryKind === 'human') return;

	let memory: Awaited<ReturnType<typeof openMemory>>;
	try {
		memory = await openMemory(
			undefined,
			cfg.judge,
			cfg.projectRoot,
			args.currentParentSessionId ? `otto:subagent:${opts.agent}` : 'otto',
			cfg.memory,
		);
	} catch (error) {
		logger.warn('[memory] unavailable', { error: String(error) });
		return;
	}

	try {
		const memoryTurn: MemoryTurnContext = {};
		if (canCapture) {
			const judge = await raceAbort(
				createJudge({ settings: cfg.judge, projectRoot: cfg.projectRoot }),
				signal,
			);
			const candidates = captureCandidates(memoryQuery);
			let results: Array<MemoryResult & { candidate: string }> = [];
			try {
				results = await raceAbort(
					captureUserMemory(
						memory,
						judge,
						memoryQuery,
						{ projectRoot: cfg.projectRoot, sessionId: opts.sessionId },
						memoryKind === 'parent-agent'
							? `relayed by parent agent; parentSessionId=${args.currentParentSessionId}; assistant=${opts.assistantMessageId}`
							: `user turn before assistant ${opts.assistantMessageId}`,
					),
					signal,
				);
			} catch (error) {
				throwIfRunAborted(signal);
				logger.warn('[memory] capture unavailable', { error: String(error) });
			}
			memoryTurn.capture = {
				candidates,
				results,
				...(!judge ? { reason: 'no-judge' as const } : {}),
			};
		} else {
			memoryTurn.capture = {
				candidates: [],
				results: [],
				reason: memoryPolicy.captureReason,
			};
		}

		if (memoryPolicy.core || (canRecall && memoryQuery.trim())) {
			try {
				const loaded = await raceAbort(
					loadTurnMemories(memory, {
						query: canRecall ? memoryQuery : '',
						task: memoryQuery,
						context: {
							projectRoot: cfg.projectRoot,
							sessionId: opts.sessionId,
						},
						// Orchestration memories are main-agent only.
						...(args.currentParentSessionId || memoryKind === 'parent-agent'
							? { audience: 'work' as const }
							: {}),
						core: memoryPolicy.core,
						recall: canRecall,
					}),
					signal,
				);
				if (loaded.message) {
					args.additionalSystemMessages.push({
						role: 'user',
						content: loaded.message,
					});
				}
				if (loaded.recall) memoryTurn.recall = loaded.recall;
			} catch (error) {
				throwIfRunAborted(signal);
				logger.warn('[memory] recall unavailable', { error: String(error) });
			}
		}
		throwIfRunAborted(signal);
		await persistMemoryTurnContext(db, opts, memoryTurn);
	} catch (error) {
		throwIfRunAborted(signal);
		logger.warn('[memory] unavailable', { error: String(error) });
	} finally {
		memory.close();
	}
}
