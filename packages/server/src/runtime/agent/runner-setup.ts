import { discoverProjectTools, loadConfig, logger } from '@ottocode/sdk';
import { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import type { Tool } from 'ai';
import { adaptTools } from '../../tools/adapter.ts';
import type { ToolAdapterContext } from '../../tools/adapter.ts';
import { buildDatabaseTools } from '../../tools/database/index.ts';
import { time } from '../debug/index.ts';
import { buildHistoryMessages } from '../message/history-builder.ts';
import { setupToolContext } from '../tools/setup.ts';
import type { RunOpts } from '../session/queue.ts';
import { resolveAgentConfig } from './registry.ts';
import {
	appendRunnerPromptMessages,
	buildRunnerPrompt,
} from './runner-setup-prompt.ts';
import {
	buildAllowedTools,
	applyModelFamilyEditToolPolicy,
	mergeProviderOptions,
} from './runner-setup-tools.ts';
import {
	buildRunnerProviderOptions,
	resolveRunnerModel,
} from './runner-setup-model.ts';
import { nowMs, timePromise } from './runner-setup-utils.ts';

export { applyModelFamilyEditToolPolicy, mergeProviderOptions };

type RunnerSetupTimings = {
	loadConfigAndDbMs: number;
	resolveAgentConfigMs: number;
	buildHistoryMs: number;
	loadSessionMs: number;
	composeSystemPromptMs: number;
	discoverToolsMs: number;
	resolveModelMs: number;
	setupToolContextMs: number;
	buildToolsetMs: number;
	totalMs: number;
};

export interface SetupResult {
	cfg: Awaited<ReturnType<typeof loadConfig>>;
	db: Awaited<ReturnType<typeof getDb>>;
	agentCfg: Awaited<ReturnType<typeof resolveAgentConfig>>;
	history: Awaited<ReturnType<typeof buildHistoryMessages>>;
	system: string;
	systemComponents: string[];
	additionalSystemMessages: Array<{ role: 'system' | 'user'; content: string }>;
	model: Awaited<ReturnType<typeof resolveRunnerModel>>['model'];
	maxOutputTokens: number | undefined;
	effectiveMaxOutputTokens: number | undefined;
	toolset: ReturnType<typeof adaptTools>;
	sharedCtx: ToolAdapterContext;
	firstToolTimer: ReturnType<typeof time>;
	firstToolSeen: () => boolean;
	providerOptions: Record<string, unknown>;
	needsSpoof: boolean;
	isOpenAIOAuth: boolean;
	mcpToolsRecord: Record<string, Tool>;
	timings: RunnerSetupTimings;
}

export async function setupRunner(opts: RunOpts): Promise<SetupResult> {
	const setupStartedAt = nowMs();
	const cfgTimer = time('runner:loadConfig+db');
	const loadConfigAndDbStartedAt = nowMs();
	const cfg = await loadConfig(opts.projectRoot);
	const db = await getDb(cfg.projectRoot);
	const loadConfigAndDbMs = nowMs() - loadConfigAndDbStartedAt;
	cfgTimer.end();

	const agentTimer = time('runner:resolveAgentConfig');
	const agentCfgPromise = timePromise(
		resolveAgentConfig(cfg.projectRoot, opts.agent),
	);
	const historyPromise =
		opts.omitHistory || (opts.isCompactCommand && opts.compactionContext)
			? Promise.resolve({ value: [], durationMs: 0 })
			: timePromise(
					buildHistoryMessages(db, opts.sessionId, opts.assistantMessageId),
				);
	const sessionRowsPromise = timePromise(
		db.select().from(sessions).where(eq(sessions.id, opts.sessionId)).limit(1),
	);
	const discoveredToolsPromise = timePromise(
		discoverProjectTools(cfg.projectRoot, undefined, cfg.skills),
	);
	const { value: agentCfg, durationMs: resolveAgentConfigMs } =
		await agentCfgPromise;
	agentTimer.end({ agent: opts.agent });

	const historyTimer = time('runner:buildHistory');
	const { value: history, durationMs: buildHistoryMs } = await historyPromise;
	historyTimer.end({ messages: history.length });

	const { value: sessionRows, durationMs: loadSessionMs } =
		await sessionRowsPromise;
	const contextSummary = sessionRows[0]?.contextSummary ?? undefined;
	const toolsTimer = time('runner:discoverTools');
	const { value: discovered, durationMs: discoverToolsMs } =
		await discoveredToolsPromise;
	const allTools = discovered.tools;
	const { mcpToolsRecord } = discovered;

	if (opts.agent === 'research') {
		const currentSession = sessionRows[0];
		const parentSessionId = currentSession?.parentSessionId ?? null;
		const dbTools = buildDatabaseTools(cfg.projectRoot, parentSessionId);
		for (const dt of dbTools) {
			discovered.tools.push(dt);
		}
	}

	toolsTimer.end({
		count: allTools.length + Object.keys(mcpToolsRecord).length,
	});

	const isFirstMessage = !history.some((m) => m.role === 'assistant');

	const systemTimer = time('runner:composeSystemPrompt');
	const prompt = await buildRunnerPrompt({
		opts,
		cfg,
		agentPrompt: agentCfg.prompt || '',
		contextSummary,
		historyLength: history.length,
		isFirstMessage,
	});
	systemTimer.end();
	appendRunnerPromptMessages({
		opts,
		additionalSystemMessages: prompt.additionalSystemMessages,
	});

	const gated = buildAllowedTools({
		agentName: agentCfg.name,
		agentTools: agentCfg.tools || [],
		provider: opts.provider,
		model: opts.model,
		cfg,
		allTools,
	});

	const { model, resolveModelMs } = await resolveRunnerModel({ opts, cfg });

	const setupToolContextStartedAt = nowMs();
	const { sharedCtx, firstToolTimer, firstToolSeen } = await setupToolContext(
		opts,
		db,
	);
	const setupToolContextMs = nowMs() - setupToolContextStartedAt;

	const buildToolsetStartedAt = nowMs();
	const { getAuth } = await import('@ottocode/sdk');
	const providerAuth = await getAuth(opts.provider, opts.projectRoot);
	const authType = providerAuth?.type;
	const toolset = adaptTools(gated, sharedCtx, opts.provider, authType);
	const buildToolsetMs = nowMs() - buildToolsetStartedAt;

	const { providerOptions, effectiveMaxOutputTokens } =
		buildRunnerProviderOptions({
			cfg,
			opts,
			adaptedProviderOptions: prompt.providerOptions,
			maxOutputTokens: prompt.maxOutputTokens,
		});

	const timings: RunnerSetupTimings = {
		loadConfigAndDbMs,
		resolveAgentConfigMs,
		buildHistoryMs,
		loadSessionMs,
		composeSystemPromptMs: prompt.composeSystemPromptMs,
		discoverToolsMs,
		resolveModelMs,
		setupToolContextMs,
		buildToolsetMs,
		totalMs: nowMs() - setupStartedAt,
	};

	logger.info('[latency] runner setup', {
		sessionId: opts.sessionId,
		messageId: opts.assistantMessageId,
		agent: opts.agent,
		provider: opts.provider,
		model: opts.model,
		historyMessages: history.length,
		systemPromptChars: prompt.effectiveSystemPrompt.length,
		additionalPromptMessages: prompt.additionalSystemMessages.length,
		allowedToolCount: gated.length,
		timings,
	});

	return {
		cfg,
		db,
		agentCfg,
		history,
		system: prompt.system,
		systemComponents: prompt.systemComponents,
		additionalSystemMessages: prompt.additionalSystemMessages,
		model,
		maxOutputTokens: prompt.maxOutputTokens,
		effectiveMaxOutputTokens,
		toolset,
		sharedCtx,
		firstToolTimer,
		firstToolSeen,
		providerOptions,
		needsSpoof: prompt.needsSpoof,
		isOpenAIOAuth: prompt.isOpenAIOAuth,
		mcpToolsRecord,
		timings,
	};
}
