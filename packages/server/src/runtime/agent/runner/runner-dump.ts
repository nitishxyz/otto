import { logger } from '@ottocode/sdk';
import { createTurnDumpCollector } from '../../debug/turn-dump.ts';
import { toErrorMessage } from '../../errors/handling.ts';
import type { RunOpts } from '../../session/queue.ts';
import type { SetupResult } from './runner-setup.ts';
import type { RunnerTextState } from './runner-text.ts';

export type TurnDumpCollector = NonNullable<
	ReturnType<typeof createTurnDumpCollector>
>;

export function createRunnerTurnDump(args: {
	opts: RunOpts;
	setup: SetupResult;
	messagesWithSystemInstructions: Array<{
		role: string;
		content: string | unknown[];
	}>;
	toolset: Record<string, unknown>;
	effectiveMaxOutputTokens: number | undefined;
	providerOptions: Record<string, unknown>;
	isOpenAIOAuth: boolean;
}): TurnDumpCollector | null {
	const { opts, setup } = args;
	const dump = createTurnDumpCollector({
		sessionId: opts.sessionId,
		messageId: opts.assistantMessageId,
		provider: opts.provider,
		model: opts.model,
		agent: opts.agent,
		continuationCount: opts.continuationCount,
	});
	if (!dump) return null;

	dump.setSystemPrompt(setup.system, setup.systemComponents);
	dump.setAdditionalSystemMessages(
		setup.additionalSystemMessages as Array<{ role: string; content: string }>,
	);
	dump.setHistory(setup.history as Array<{ role: string; content: unknown }>);
	dump.setFinalMessages(args.messagesWithSystemInstructions);
	dump.setTools(args.toolset);
	dump.setModelConfig({
		maxOutputTokens: setup.maxOutputTokens,
		effectiveMaxOutputTokens: args.effectiveMaxOutputTokens,
		providerOptions: args.providerOptions,
		isOpenAIOAuth: args.isOpenAIOAuth,
		needsSpoof: setup.needsSpoof,
	});

	return dump;
}

export function recordRunnerStreamEnd(args: {
	dump: TurnDumpCollector | null;
	textState: RunnerTextState;
	stepIndex: number;
	finishReason: string | undefined;
	rawFinishReason: string | undefined;
	aborted: boolean;
}) {
	const { dump } = args;
	if (!dump) return;

	const finalTextSnapshot =
		args.textState.latestAssistantText || args.textState.accumulated;
	if (finalTextSnapshot.length > 0) {
		dump.recordTextDelta(
			args.textState.lastTextDeltaStepIndex ?? args.stepIndex,
			finalTextSnapshot,
			{ force: true },
		);
	}
	dump.recordStreamEnd({
		finishReason: args.finishReason,
		rawFinishReason: args.rawFinishReason,
		aborted: args.aborted,
	});
}

export async function flushRunnerTurnDump(args: {
	dump: TurnDumpCollector | null;
	projectRoot: string;
	sessionId: string;
	messageId: string;
}) {
	if (!args.dump) return;

	try {
		await args.dump.flush(args.projectRoot);
	} catch (error) {
		logger.debug('[agent] failed to flush turn dump', {
			sessionId: args.sessionId,
			messageId: args.messageId,
			error: toErrorMessage(error),
		});
	}
}
