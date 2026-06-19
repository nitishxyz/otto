import { streamText } from 'ai';
import { logger } from '@ottocode/sdk';
import type { RunOpts } from '../../session/queue.ts';
import type { SetupResult } from './runner-setup.ts';
import { nowMs } from './runner-telemetry.ts';

export function invokeRunnerStreamText(args: {
	opts: RunOpts;
	model: SetupResult['model'];
	toolset: Record<string, unknown>;
	system: string;
	messages: unknown[];
	effectiveMaxOutputTokens: number | undefined;
	providerOptions: Record<string, unknown>;
	abortSignal: AbortSignal | undefined;
	stopWhen: unknown;
	prepareStep: unknown;
	onStepFinish: unknown;
	onError: unknown;
	onAbort: unknown;
	onFinish: unknown;
	queueWaitMs: number;
	setupMs: number;
}): ReturnType<typeof streamText> {
	const streamInvocationStartedAt = nowMs();
	logger.info('[latency] streamText invoke', {
		sessionId: args.opts.sessionId,
		messageId: args.opts.assistantMessageId,
		agent: args.opts.agent,
		provider: args.opts.provider,
		model: args.opts.model,
		queueWaitMs: args.queueWaitMs,
		setupMs: args.setupMs,
	});

	const result = streamText({
		model: args.model,
		tools: args.toolset,
		...(args.system ? { system: args.system } : {}),
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK message types are complex
		messages: args.messages as any,
		...(args.effectiveMaxOutputTokens
			? { maxOutputTokens: args.effectiveMaxOutputTokens }
			: {}),
		...(Object.keys(args.providerOptions).length > 0
			? { providerOptions: args.providerOptions }
			: {}),
		abortSignal: args.abortSignal,
		stopWhen: args.stopWhen,
		...(args.prepareStep ? { prepareStep: args.prepareStep } : {}),
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK callback types mismatch
		onStepFinish: args.onStepFinish as any,
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK callback types mismatch
		onError: args.onError as any,
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK callback types mismatch
		onAbort: args.onAbort as any,
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK callback types mismatch
		onFinish: args.onFinish as any,
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK streamText options type
	} as any);

	logger.info('[latency] streamText returned', {
		sessionId: args.opts.sessionId,
		messageId: args.opts.assistantMessageId,
		agent: args.opts.agent,
		provider: args.opts.provider,
		model: args.opts.model,
		invokeMs: nowMs() - streamInvocationStartedAt,
	});
	return result;
}
