import type { getDb } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish } from '../../events/bus.ts';
import type { RunOpts } from '../session/queue.ts';
import type { ToolAdapterContext } from '../../tools/adapter.ts';
import type { UsageData, ProviderMetadata } from '../session/db-operations.ts';
import type { StepFinishEvent } from './types.ts';

export function createStepFinishHandler(
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
	getStepIndex: () => number,
	incrementStepIndex: () => number,
	getCurrentPartId: () => string | null,
	updateCurrentPartId: (id: string | null) => void,
	updateAccumulated: (text: string) => void,
	triggerTitleGenerationWhenReady: () => void,
	sharedCtx: ToolAdapterContext,
	updateSessionTokensIncrementalFn: (
		usage: UsageData,
		providerOptions: ProviderMetadata | undefined,
		opts: RunOpts,
		db: Awaited<ReturnType<typeof getDb>>,
	) => Promise<void>,
	updateMessageTokensIncrementalFn: (
		usage: UsageData,
		providerOptions: ProviderMetadata | undefined,
		opts: RunOpts,
		db: Awaited<ReturnType<typeof getDb>>,
	) => Promise<void>,
) {
	return async (step: StepFinishEvent) => {
		triggerTitleGenerationWhenReady();

		const finishedAt = Date.now();
		const currentPartId = getCurrentPartId();
		const stepIndex = getStepIndex();

		try {
			if (currentPartId) {
				await db
					.update(messageParts)
					.set({ completedAt: finishedAt })
					.where(eq(messageParts.id, currentPartId));
			}
		} catch {}

		if (step.usage) {
			try {
				await updateSessionTokensIncrementalFn(
					step.usage,
					step.providerMetadata,
					opts,
					db,
				);
			} catch {}

			try {
				await updateMessageTokensIncrementalFn(
					step.usage,
					step.providerMetadata,
					opts,
					db,
				);
			} catch {}
		}

		try {
			publish({
				type: 'finish-step',
				sessionId: opts.sessionId,
				projectId: opts.projectId,
				projectRoot: opts.projectRoot,
				payload: {
					stepIndex,
					usage: step.usage,
					finishReason: step.finishReason,
					response: step.response,
				},
			});
			if (step.usage) {
				publish({
					type: 'usage',
					sessionId: opts.sessionId,
					projectId: opts.projectId,
					projectRoot: opts.projectRoot,
					payload: { stepIndex, ...step.usage },
				});
			}
		} catch {}

		try {
			const newStepIndex = incrementStepIndex();
			sharedCtx.stepIndex = newStepIndex;
			updateCurrentPartId(null);
			updateAccumulated('');
		} catch {}
	};
}
