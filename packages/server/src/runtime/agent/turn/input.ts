import { discoverProjectTools, type loadConfig } from '@ottocode/sdk';
import type { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { resolveReferences } from '../../context/references.ts';
import { time } from '../../debug/index.ts';
import { buildHistoryMessages } from '../../message/history-builder.ts';
import type { RunOpts } from '../../session/queue.ts';
import { resolveAgentConfig } from '../registry.ts';
import { timePromise } from '../runner/runner-setup-utils.ts';
import { raceAbort } from './abort.ts';

/**
 * Loads everything a turn reads before prompt/tool assembly: agent config,
 * history, session row, references, and discovered project tools. Loads run
 * concurrently and the whole phase rejects as soon as the run is cancelled.
 */
export async function loadTurnInput(args: {
	opts: RunOpts;
	cfg: Awaited<ReturnType<typeof loadConfig>>;
	db: Awaited<ReturnType<typeof getDb>>;
}) {
	const { opts, cfg, db } = args;
	const signal = opts.abortSignal;

	const agentTimer = time('runner:resolveAgentConfig');
	const agentCfgPromise = timePromise(
		resolveAgentConfig(cfg.projectRoot, opts.agent),
	);
	const historyPromise =
		opts.omitHistory || (opts.isCompactCommand && opts.compactionContext)
			? Promise.resolve({ value: [], durationMs: 0 })
			: timePromise(
					buildHistoryMessages(db, opts.sessionId, opts.assistantMessageId, {
						projectRoot: cfg.projectRoot,
					}),
				);
	const sessionRowsPromise = timePromise(
		db.select().from(sessions).where(eq(sessions.id, opts.sessionId)).limit(1),
	);
	const references = await raceAbort(resolveReferences(cfg), signal);
	const referenceRoots = references.flatMap((reference) =>
		reference.path ? [reference.path] : [],
	);
	const discoveredToolsPromise = timePromise(
		discoverProjectTools(cfg.projectRoot, cfg.skills, referenceRoots, {
			judge: cfg.judge,
		}),
	);
	for (const pending of [
		agentCfgPromise,
		historyPromise,
		sessionRowsPromise,
		discoveredToolsPromise,
	]) {
		(pending as Promise<unknown>).catch(() => undefined);
	}

	const { value: agentCfg, durationMs: resolveAgentConfigMs } = await raceAbort(
		agentCfgPromise,
		signal,
	);
	agentTimer.end({ agent: opts.agent });

	const historyTimer = time('runner:buildHistory');
	const { value: history, durationMs: buildHistoryMs } = await raceAbort(
		historyPromise,
		signal,
	);
	historyTimer.end({ messages: history.length });

	const { value: sessionRows, durationMs: loadSessionMs } = await raceAbort(
		sessionRowsPromise,
		signal,
	);
	const toolsTimer = time('runner:discoverTools');
	const { value: discovered, durationMs: discoverToolsMs } = await raceAbort(
		discoveredToolsPromise,
		signal,
	);

	return {
		agentCfg,
		history,
		session: sessionRows[0],
		references,
		discovered,
		toolsTimer,
		timings: {
			resolveAgentConfigMs,
			buildHistoryMs,
			loadSessionMs,
			discoverToolsMs,
		},
	};
}
