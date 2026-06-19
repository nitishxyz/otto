import { logger } from '@ottocode/sdk';
import type { getDb } from '@ottocode/database';
import { messages } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { toErrorMessage } from '../../errors/handling.ts';
import type { RunOpts } from '../../session/queue.ts';
import type { RunnerTextState } from './runner-text.ts';
import type { RunnerToolObserverState } from './runner-tool-observer.ts';

type StreamFinishSource = {
	finishReason: PromiseLike<string | undefined>;
	rawFinishReason: PromiseLike<string | undefined>;
};

async function readStreamFinishReasons(result: StreamFinishSource): Promise<{
	finishReason: string | undefined;
	rawFinishReason: string | undefined;
}> {
	let finishReason: string | undefined;
	try {
		finishReason = await result.finishReason;
	} catch {
		finishReason = undefined;
	}

	let rawFinishReason: string | undefined;
	try {
		rawFinishReason = await result.rawFinishReason;
	} catch {
		rawFinishReason = undefined;
	}

	return { finishReason, rawFinishReason };
}

export async function persistRunnerStreamFinishDetails(args: {
	result: StreamFinishSource;
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	firstToolSeen: () => boolean;
	toolObserver: RunnerToolObserverState;
	textState: RunnerTextState;
}): Promise<{
	finishReason: string | undefined;
	rawFinishReason: string | undefined;
}> {
	const { finishReason, rawFinishReason } = await readStreamFinishReasons(
		args.result,
	);

	try {
		const existingRows = await args.db
			.select({ finishDetails: messages.finishDetails })
			.from(messages)
			.where(eq(messages.id, args.opts.assistantMessageId))
			.limit(1);
		let finishDetails: Record<string, unknown> = {};
		try {
			finishDetails = existingRows[0]?.finishDetails
				? JSON.parse(existingRows[0].finishDetails)
				: {};
		} catch {
			finishDetails = {};
		}
		await args.db
			.update(messages)
			.set({
				finishReason,
				rawFinishReason,
				finishDetails: JSON.stringify({
					...finishDetails,
					stream: {
						firstToolSeen: args.firstToolSeen(),
						lastToolName: args.toolObserver.lastToolName,
						endedWithToolActivity: args.toolObserver.endedWithToolActivity,
						hasTrailingAssistantText:
							(
								args.textState.latestAssistantText || args.textState.accumulated
							).trim().length > 0,
						continuationCount: args.opts.continuationCount ?? 0,
					},
				}),
			})
			.where(eq(messages.id, args.opts.assistantMessageId));
	} catch (error) {
		logger.debug('[agent] failed to persist stream finish details', {
			sessionId: args.opts.sessionId,
			messageId: args.opts.assistantMessageId,
			error: toErrorMessage(error),
		});
	}

	return { finishReason, rawFinishReason };
}
