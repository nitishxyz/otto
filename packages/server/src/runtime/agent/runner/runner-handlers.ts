import type { getDb } from '@ottocode/database';
import type { loadConfig } from '@ottocode/sdk';
import { triggerDeferredTitleGeneration } from '../../message/service.ts';
import {
	updateMessageTokensIncremental,
	updateSessionTokensIncremental,
} from '../../session/db-operations.ts';
import type { RunOpts } from '../../session/queue.ts';
import {
	createAbortHandler,
	createErrorHandler,
	createStepFinishHandler,
} from '../../stream/handlers.ts';
import type { ToolAdapterContext } from '../../../tools/adapter.ts';
import type { RunSessionLoop } from '../turn/types.ts';
import { flushRunnerTextPart, type RunnerTextState } from './runner-text.ts';

/**
 * Builds the per-run stream callbacks. `onStepFinish` is passed to the AI SDK;
 * `persistError` and `persistAbort` are terminal writers invoked only by the
 * turn executor after it has decided the outcome.
 */
export function createRunnerStreamHandlers(args: {
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	cfg: Awaited<ReturnType<typeof loadConfig>>;
	sharedCtx: ToolAdapterContext;
	textState: RunnerTextState;
	isFirstMessage: boolean;
	getStepIndex: () => number;
	incrementStepIndex: () => number;
	runSessionLoop: RunSessionLoop;
}) {
	let titleGenerationTriggered = false;

	const getCurrentPartId = () => args.textState.currentPartId;
	const updateCurrentPartId = (id: string | null) => {
		args.textState.currentPartId = id;
	};
	const updateAccumulated = (text: string) => {
		args.textState.accumulated = text;
	};
	// Text delta persistence is throttled; flush pending content before any
	// handler that completes, errors, or aborts the current text part.
	const flushTextPart = async () => {
		await flushRunnerTextPart(args.textState, args.db);
	};
	const triggerTitleGenerationWhenReady = () => {
		if (titleGenerationTriggered) return;

		titleGenerationTriggered = true;
		if (!args.isFirstMessage) return;

		void triggerDeferredTitleGeneration({
			cfg: args.cfg,
			db: args.db,
			sessionId: args.opts.sessionId,
		});
	};

	const baseOnStepFinish = createStepFinishHandler(
		args.opts,
		args.db,
		args.getStepIndex,
		args.incrementStepIndex,
		getCurrentPartId,
		updateCurrentPartId,
		updateAccumulated,
		triggerTitleGenerationWhenReady,
		args.sharedCtx,
		updateSessionTokensIncremental,
		updateMessageTokensIncremental,
	);
	const onStepFinish = async (
		event: Parameters<typeof baseOnStepFinish>[0],
	) => {
		await flushTextPart();
		await baseOnStepFinish(event);
	};

	const baseOnError = createErrorHandler(
		args.opts,
		args.db,
		args.getStepIndex,
		args.sharedCtx,
		args.runSessionLoop,
	);
	const persistError = async (error: unknown) => {
		await baseOnError(error);
	};

	const baseOnAbort = createAbortHandler(
		args.opts,
		args.db,
		args.getStepIndex,
		args.sharedCtx,
	);
	const persistAbort = async (event: Parameters<typeof baseOnAbort>[0]) => {
		await baseOnAbort(event);
	};

	return {
		onStepFinish,
		persistError,
		persistAbort,
		flushTextPart,
		triggerTitleGenerationWhenReady,
	};
}
