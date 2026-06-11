import {
	buildLoadFirstPartyToolsTool,
	discoverProjectTools,
	loadConfig,
	logger,
} from '@ottocode/sdk';
import { getDb } from '@ottocode/database';
import { goals, sessions } from '@ottocode/database/schema';
import { and, eq } from 'drizzle-orm';
import type { Tool } from 'ai';
import { adaptTools } from '../../tools/adapter.ts';
import type { ToolAdapterContext } from '../../tools/adapter.ts';
import { buildDatabaseTools } from '../../tools/database/index.ts';
import { buildSubagentTools } from '../../tools/subagents/index.ts';
import { buildGoalTools } from '../../tools/goals/index.ts';
import { buildEnqueueSessionMessageTool } from '../../tools/otto/index.ts';
import { time } from '../debug/index.ts';
import { buildHistoryMessages } from '../message/history-builder.ts';
import { setupToolContext } from '../tools/setup.ts';
import type { RunOpts } from '../session/queue.ts';
import { flattenAgentToolConfig, resolveAgentConfig } from './registry.ts';
import {
	appendRunnerPromptMessages,
	buildRunnerPrompt,
	moveSystemMessagesToUserForOpenAIOAuth,
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

const DATABASE_TOOL_NAMES = new Set([
	'query_sessions',
	'query_messages',
	'get_session_context',
	'search_history',
	'present_action',
]);

const SUBAGENT_TOOL_NAMES = new Set([
	'delegate_task',
	'list_subagents',
	'message_subagent',
]);
const GOAL_TOOL_NAMES = new Set(['goal_list', 'goal_update']);
const NO_DELEGATION_SESSION_TYPES = new Set(['subagent', 'otto']);
const NO_GOAL_SESSION_TYPES = new Set(['subagent', 'research', 'btw']);

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
	lazyToolsRecord: Record<string, Tool>;
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
	let allTools = discovered.tools;
	let { lazyToolsRecord } = discovered;
	const { mcpToolsRecord } = discovered;

	const configuredToolNames = new Set(
		flattenAgentToolConfig(agentCfg.toolConfig),
	);
	const needsDatabaseTools =
		opts.agent === 'research' ||
		Array.from(configuredToolNames).some((name) =>
			DATABASE_TOOL_NAMES.has(name),
		);

	if (needsDatabaseTools) {
		const currentSession = sessionRows[0];
		const parentSessionId = currentSession?.parentSessionId ?? null;
		const dbTools = buildDatabaseTools(cfg.projectRoot, parentSessionId);
		for (const dt of dbTools) {
			discovered.tools.push(dt);
		}
	}

	const currentSessionType = sessionRows[0]?.sessionType ?? 'main';
	const currentParentSessionId = sessionRows[0]?.parentSessionId ?? null;
	const ottoEnabled = cfg.defaults.ottoEnabled !== false;

	const needsSubagentTools =
		!NO_DELEGATION_SESSION_TYPES.has(currentSessionType) &&
		Array.from(configuredToolNames).some((name) =>
			SUBAGENT_TOOL_NAMES.has(name),
		);
	if (needsSubagentTools) {
		for (const item of buildSubagentTools(cfg.projectRoot, opts.sessionId)) {
			discovered.tools.push(item);
		}
	}

	let needsGoalTools =
		ottoEnabled &&
		(opts.agent === 'otto' ||
			Array.from(configuredToolNames).some((name) =>
				GOAL_TOOL_NAMES.has(name),
			));
	// Any main session with an active goal gets the goal tools, even when the
	// agent's toolset doesn't list them — otherwise the agent cannot claim
	// tasks and otto nudges it in circles.
	if (
		!needsGoalTools &&
		ottoEnabled &&
		!NO_GOAL_SESSION_TYPES.has(currentSessionType)
	) {
		const activeGoal = await db
			.select({ id: goals.id })
			.from(goals)
			.where(
				and(eq(goals.sessionId, opts.sessionId), eq(goals.status, 'active')),
			)
			.limit(1);
		needsGoalTools = activeGoal.length > 0;
	}
	if (needsGoalTools) {
		const goalSessionId =
			currentSessionType === 'otto' && currentParentSessionId
				? currentParentSessionId
				: opts.sessionId;
		const goalTools = buildGoalTools({
			projectRoot: cfg.projectRoot,
			goalSessionId,
			allowComplete: opts.agent === 'otto',
		});
		for (const item of goalTools) {
			discovered.tools.push(item);
		}
	}

	if (
		opts.agent === 'otto' &&
		currentSessionType === 'otto' &&
		currentParentSessionId
	) {
		discovered.tools.push(
			buildEnqueueSessionMessageTool(cfg.projectRoot, currentParentSessionId),
		);
	}

	const configuredLoadableNames = new Set(agentCfg.toolConfig.loadable ?? []);
	for (const toolItem of allTools) {
		if (!configuredLoadableNames.has(toolItem.name)) continue;
		if (toolItem.name === 'load_tools' || toolItem.name === 'load_mcp_tools')
			continue;
		lazyToolsRecord[toolItem.name] = toolItem.tool;
	}

	const allowedLazyToolNames = Object.keys(lazyToolsRecord).filter((name) =>
		configuredLoadableNames.has(name),
	);
	if (allowedLazyToolNames.length !== Object.keys(lazyToolsRecord).length) {
		lazyToolsRecord = Object.fromEntries(
			allowedLazyToolNames.map((name) => [name, lazyToolsRecord[name]]),
		) as Record<string, Tool>;
		const loadTools = buildLoadFirstPartyToolsTool(allowedLazyToolNames);
		allTools = allTools.map((item) =>
			item.name === loadTools.name ? loadTools : item,
		);
	}

	toolsTimer.end({
		count:
			allTools.length +
			Object.keys(lazyToolsRecord).length +
			Object.keys(mcpToolsRecord).length,
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
	if (prompt.isOpenAIOAuth) {
		moveSystemMessagesToUserForOpenAIOAuth(prompt.additionalSystemMessages);
	}

	const gated = buildAllowedTools({
		agentName: agentCfg.name,
		agentTools: agentCfg.toolConfig.firstClass || [],
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
		lazyToolsRecord,
		mcpToolsRecord,
		timings,
	};
}
