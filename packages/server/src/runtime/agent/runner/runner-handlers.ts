import type { getDb } from '@ottocode/database';
import type { loadConfig } from '@ottocode/sdk';
import { triggerDeferredTitleGeneration } from '../../message/service.ts';
import {
	completeAssistantMessage,
	updateMessageTokensIncremental,
	updateSessionTokensIncremental,
} from '../../session/db-operations.ts';
import {
	isSendNowPreemptReason,
	isSystemAbortReason,
	type RunOpts,
} from '../../session/queue.ts';
import {
	createAbortHandler,
	createErrorHandler,
	createFinishHandler,
	createStepFinishHandler,
} from '../../stream/handlers.ts';
import type { ToolAdapterContext } from '../../../tools/adapter.ts';
import type { RunnerTextState } from './runner-text.ts';

type RunSessionLoop = (sessionId: string) => Promise<void>;

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
	const state = {
		abortedByUser: false,
		sendNowPreemptHandled: false,
		abortHandled: false,
		titleGenerationTriggered: false,
	};

	const getCurrentPartId = () => args.textState.currentPartId;
	const updateCurrentPartId = (id: string | null) => {
		args.textState.currentPartId = id;
	};
	const updateAccumulated = (text: string) => {
		args.textState.accumulated = text;
	};
	const triggerTitleGenerationWhenReady = () => {
		if (state.titleGenerationTriggered) return;

		state.titleGenerationTriggered = true;
		if (!args.isFirstMessage) return;

		void triggerDeferredTitleGeneration({
			cfg: args.cfg,
			db: args.db,
			sessionId: args.opts.sessionId,
		});
	};

	const onStepFinish = createStepFinishHandler(
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

	const onError = createErrorHandler(
		args.opts,
		args.db,
		args.getStepIndex,
		args.sharedCtx,
		args.runSessionLoop,
	);

	const baseOnAbort = createAbortHandler(
		args.opts,
		args.db,
		args.getStepIndex,
		args.sharedCtx,
	);
	const onAbort = async (event: Parameters<typeof baseOnAbort>[0]) => {
		const abortReason = (
			args.opts.abortSignal as (AbortSignal & { reason?: unknown }) | undefined
		)?.reason;
		const isSendNowPreempt = isSendNowPreemptReason(abortReason);
		if (state.abortHandled) return;
		state.abortHandled = true;
		state.abortedByUser =
			!isSendNowPreempt && !isSystemAbortReason(abortReason);
		state.sendNowPreemptHandled = isSendNowPreempt;
		await baseOnAbort(event);
	};

	return {
		onStepFinish,
		onError,
		onAbort,
		onFinish: createFinishHandler(args.opts, args.db, completeAssistantMessage),
		triggerTitleGenerationWhenReady,
		getAbortedByUser: () => state.abortedByUser,
		getSendNowPreemptHandled: () => state.sendNowPreemptHandled,
	};
}
