import { wrapLanguageModel } from 'ai';
import { devToolsMiddleware } from '@ai-sdk/devtools';
import type { OttoConfig } from '@ottocode/sdk';
import { getCopilotTransport } from '@ottocode/sdk/providers';
import { isDevtoolsEnabled } from '../../debug/state.ts';
import { resolveModel } from '../../provider/index.ts';
import { buildReasoningConfig } from '../../provider/reasoning.ts';
import type { RunOpts } from '../../session/queue.ts';
import { mergeProviderOptions } from './runner-setup-tools.ts';
import { nowMs } from './runner-setup-utils.ts';

export type RunnerModelTransport =
	| 'default'
	| 'copilot-responses'
	| 'copilot-chat';

export type RunnerModelCapabilities = {
	transport: RunnerModelTransport;
};

/** Transport/capability decision for a resolved model, made in one place. */
export function resolveRunnerModelCapabilities(
	opts: Pick<RunOpts, 'provider' | 'model'>,
): RunnerModelCapabilities {
	if (opts.provider === 'copilot') {
		return {
			transport:
				getCopilotTransport(opts.model) === 'responses'
					? 'copilot-responses'
					: 'copilot-chat',
		};
	}
	return { transport: 'default' };
}

export async function resolveRunnerModel(args: {
	opts: RunOpts;
	cfg: OttoConfig;
}): Promise<{
	model:
		| Awaited<ReturnType<typeof resolveModel>>
		| ReturnType<typeof wrapLanguageModel>;
	resolveModelMs: number;
	capabilities: RunnerModelCapabilities;
}> {
	const resolveModelStartedAt = nowMs();
	const model = await resolveModel(
		args.opts.provider,
		args.opts.model,
		args.cfg,
		{
			sessionId: args.opts.sessionId,
			messageId: args.opts.assistantMessageId,
			reasoningText: args.opts.reasoningText,
			abortSignal: args.opts.abortSignal,
		},
	);
	const resolveModelMs = nowMs() - resolveModelStartedAt;
	const wrappedModel = isDevtoolsEnabled()
		? wrapLanguageModel({
				// biome-ignore lint/suspicious/noExplicitAny: OpenRouter provider uses v2 spec
				model: model as any,
				middleware: devToolsMiddleware(),
			})
		: model;

	return {
		model: wrappedModel,
		resolveModelMs,
		capabilities: resolveRunnerModelCapabilities(args.opts),
	};
}

export function buildRunnerProviderOptions(args: {
	cfg: OttoConfig;
	opts: RunOpts;
	adaptedProviderOptions: Record<string, unknown>;
	maxOutputTokens: number | undefined;
}): {
	providerOptions: Record<string, unknown>;
	effectiveMaxOutputTokens: number | undefined;
} {
	const providerOptions = { ...args.adaptedProviderOptions };

	if (args.opts.provider === 'copilot') {
		providerOptions.openai = {
			...((providerOptions.openai as Record<string, unknown>) || {}),
			store: false,
		};
	}

	const reasoningConfig = buildReasoningConfig({
		cfg: args.cfg,
		provider: args.opts.provider,
		model: args.opts.model,
		reasoningText: args.opts.reasoningText,
		reasoningLevel: args.opts.reasoningLevel,
		maxOutputTokens: args.maxOutputTokens,
	});
	mergeProviderOptions(providerOptions, reasoningConfig.providerOptions);

	return {
		providerOptions,
		effectiveMaxOutputTokens: reasoningConfig.effectiveMaxOutputTokens,
	};
}
