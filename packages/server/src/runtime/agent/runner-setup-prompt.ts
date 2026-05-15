import {
	getConfiguredProviderFamily,
	getSessionSystemPromptPath,
	logger,
	type OttoConfig,
} from '@ottocode/sdk';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { composeSystemPrompt } from '../prompt/builder.ts';
import { isDebugEnabled } from '../debug/state.ts';
import { getMaxOutputTokens } from '../utils/token.ts';
import { getCompactionSystemPrompt } from '../message/compaction.ts';
import { adaptRunnerCall, detectOAuth } from '../provider/oauth-adapter.ts';
import type { RunOpts } from '../session/queue.ts';
import { nowMs } from './runner-setup-utils.ts';

export type RunnerPromptSetup = {
	system: string;
	systemComponents: string[];
	additionalSystemMessages: Array<{ role: 'system' | 'user'; content: string }>;
	maxOutputTokens: number | undefined;
	providerOptions: Record<string, unknown>;
	needsSpoof: boolean;
	isOpenAIOAuth: boolean;
	effectiveSystemPrompt: string;
	composeSystemPromptMs: number;
};

export async function buildRunnerPrompt(args: {
	opts: RunOpts;
	cfg: OttoConfig;
	agentPrompt: string;
	contextSummary?: string;
	historyLength: number;
	isFirstMessage: boolean;
}): Promise<RunnerPromptSetup> {
	const { opts, cfg, agentPrompt, contextSummary } = args;
	const composeSystemPromptStartedAt = nowMs();
	const { getAuth } = await import('@ottocode/sdk');
	const auth = await getAuth(opts.provider, cfg.projectRoot);
	const oauth = detectOAuth(opts.provider, auth);

	const composed = await composeSystemPrompt({
		provider: opts.provider,
		model: opts.model,
		promptFamily: getConfiguredProviderFamily(cfg, opts.provider, opts.model),
		skillSettings: cfg.skills,
		projectRoot: cfg.projectRoot,
		agentPrompt,
		oneShot: opts.oneShot,
		guidedMode: cfg.defaults.guidedMode,
		spoofPrompt: undefined,
		includeProjectTree: false,
		userContext: opts.userContext,
		contextSummary,
		isOpenAIOAuth: oauth.isOpenAIOAuth,
	});

	const rawMaxOutputTokens = getMaxOutputTokens(opts.provider, opts.model);
	const adapted = adaptRunnerCall(oauth, composed, {
		provider: opts.provider,
		rawMaxOutputTokens,
	});

	const { system } = adapted;
	const { systemComponents, additionalSystemMessages } = adapted;
	const openAIProviderOptions = adapted.providerOptions.openai as
		| Record<string, unknown>
		| undefined;
	const openAIInstructions =
		typeof openAIProviderOptions?.instructions === 'string'
			? openAIProviderOptions.instructions
			: '';
	const effectiveSystemPrompt = system || openAIInstructions || composed.prompt;
	const promptMode = oauth.isOpenAIOAuth
		? 'openai-oauth'
		: oauth.needsSpoof
			? 'spoof'
			: 'standard';
	const composeSystemPromptMs = nowMs() - composeSystemPromptStartedAt;

	logger.debug('[prompt] system prompt assembled', {
		sessionId: opts.sessionId,
		messageId: opts.assistantMessageId,
		agent: opts.agent,
		provider: opts.provider,
		model: opts.model,
		promptMode,
		components: systemComponents,
		systemLength: effectiveSystemPrompt.length,
		historyMessages: args.historyLength,
		additionalSystemMessages: additionalSystemMessages.length,
		isFirstMessage: args.isFirstMessage,
		isOpenAIOAuth: oauth.isOpenAIOAuth,
		needsSpoof: oauth.needsSpoof,
	});
	logger.debug('[prompt] detailed prompt context', {
		sessionId: opts.sessionId,
		messageId: opts.assistantMessageId,
		debugDetail: true,
		agentPromptLength: agentPrompt.length,
		contextSummaryLength: contextSummary?.length ?? 0,
		userContextLength: opts.userContext?.length ?? 0,
		oneShot: Boolean(opts.oneShot),
		guidedMode: Boolean(cfg.defaults.guidedMode),
		isOpenAIOAuth: oauth.isOpenAIOAuth,
		needsSpoof: oauth.needsSpoof,
		promptMode,
		rawSystemLength: system.length,
		openAIInstructionsLength: openAIInstructions.length,
		effectiveSystemPromptLength: effectiveSystemPrompt.length,
		systemComponents,
		additionalSystemMessageRoles: additionalSystemMessages.map(
			(message) => message.role,
		),
	});
	await writeDebugSystemPrompt({
		opts,
		effectiveSystemPrompt,
		promptMode,
	});

	return {
		system,
		systemComponents,
		additionalSystemMessages,
		maxOutputTokens: adapted.maxOutputTokens,
		providerOptions: adapted.providerOptions,
		needsSpoof: oauth.needsSpoof,
		isOpenAIOAuth: oauth.isOpenAIOAuth,
		effectiveSystemPrompt,
		composeSystemPromptMs,
	};
}

async function writeDebugSystemPrompt(args: {
	opts: RunOpts;
	effectiveSystemPrompt: string;
	promptMode: string;
}): Promise<void> {
	const { opts, effectiveSystemPrompt, promptMode } = args;
	if (!effectiveSystemPrompt || !isDebugEnabled()) return;

	const systemPromptPath = getSessionSystemPromptPath(opts.sessionId);
	try {
		await mkdir(dirname(systemPromptPath), { recursive: true });
		await Bun.write(systemPromptPath, effectiveSystemPrompt);
		logger.debug('[prompt] wrote system prompt file', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			path: systemPromptPath,
			debugDetail: true,
			promptMode,
			effectiveSystemPromptLength: effectiveSystemPrompt.length,
		});
	} catch (error) {
		logger.warn('[prompt] failed to write system prompt file', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export function appendRunnerPromptMessages(args: {
	opts: RunOpts;
	additionalSystemMessages: Array<{ role: 'system' | 'user'; content: string }>;
}): void {
	const { opts, additionalSystemMessages } = args;
	if (opts.isCompactCommand && opts.compactionContext) {
		const compactPrompt = getCompactionSystemPrompt();
		additionalSystemMessages.push({
			role: 'system',
			content: compactPrompt,
		});
		additionalSystemMessages.push({
			role: 'user',
			content: `Please summarize this conversation:\n\n<conversation-to-summarize>\n${opts.compactionContext}\n</conversation-to-summarize>`,
		});
	}

	if (opts.additionalPromptMessages?.length) {
		additionalSystemMessages.push(...opts.additionalPromptMessages);
	}
}

export function moveSystemMessagesToUserForOpenAIOAuth(
	messages: Array<{ role: 'system' | 'user'; content: string }>,
): void {
	for (const message of messages) {
		if (message.role !== 'system') continue;
		message.role = 'user';
		message.content = `<system-message>${message.content}</system-message>`;
	}
}
