import { loadConfig, logger, type MCPToolBrief } from '@ottocode/sdk';
import { getDb } from '@ottocode/database';
import type { Tool } from 'ai';
import type { adaptTools } from '../../../tools/adapter.ts';
import type { ToolAdapterContext } from '../../../tools/adapter.ts';
import {
	classifyMemoryTurn,
	parentTaskText,
	memoryTurnPolicy,
} from './runner-memory-policy.ts';
import { time } from '../../debug/index.ts';
import type { buildHistoryMessages } from '../../message/history-builder.ts';
import { setupToolContext } from '../../tools/setup.ts';
import type { RunOpts } from '../../session/queue.ts';
import type { resolveAgentConfig } from '../registry.ts';
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
	type RunnerModelCapabilities,
} from './runner-setup-model.ts';
import { nowMs } from './runner-setup-utils.ts';
import {
	startMCPPreload,
	type MCPPreloadHandle,
} from './runner-mcp-preload.ts';
import { throwIfRunAborted, raceAbort } from '../turn/abort.ts';
import { loadTurnInput } from '../turn/input.ts';
import { prepareTurnMemory } from '../turn/memory.ts';
import { buildTurnToolCatalog } from '../turn/tool-catalog.ts';
import { getRunProviderAuth } from '../../provider/credentials.ts';
import {
	createToolRegistrationMap,
	registerRunnerTools,
	type ToolRegistrationMap,
} from './runner-tool-registration.ts';

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
	systemSegments: import('../../prompt/builder.ts').SystemPromptSegment[];
	additionalSystemMessages: Array<{ role: 'system' | 'user'; content: string }>;
	model: Awaited<ReturnType<typeof resolveRunnerModel>>['model'];
	capabilities: RunnerModelCapabilities;
	maxOutputTokens: number | undefined;
	effectiveMaxOutputTokens: number | undefined;
	toolset: ReturnType<typeof adaptTools>;
	toolRegistration: ToolRegistrationMap;
	sharedCtx: ToolAdapterContext;
	firstToolTimer: ReturnType<typeof time>;
	firstToolSeen: () => boolean;
	providerOptions: Record<string, unknown>;
	needsSpoof: boolean;
	isOpenAIOAuth: boolean;
	lazyToolsRecord: Record<string, Tool>;
	mcpToolsRecord: Record<string, Tool>;
	mcpToolBriefs: MCPToolBrief[];
	mcpPreload: MCPPreloadHandle;
	timings: RunnerSetupTimings;
}

export async function setupRunner(opts: RunOpts): Promise<SetupResult> {
	const signal = opts.abortSignal;
	const setupStartedAt = nowMs();
	const cfgTimer = time('runner:loadConfig+db');
	const loadConfigAndDbStartedAt = nowMs();
	const cfg = await loadConfig(opts.projectRoot);
	const db = await getDb(cfg.projectRoot);
	const loadConfigAndDbMs = nowMs() - loadConfigAndDbStartedAt;
	cfgTimer.end();
	throwIfRunAborted(signal);

	const input = await loadTurnInput({ opts, cfg, db });
	const { agentCfg, history, session, references, discovered } = input;
	const { mcpToolsRecord, mcpToolBriefs } = discovered;
	const mcpPreload = startMCPPreload({ opts, cfg, briefs: mcpToolBriefs });

	const currentSessionType = session?.sessionType ?? 'main';
	const currentParentSessionId = session?.parentSessionId ?? null;
	const memoryKind = classifyMemoryTurn(opts, currentSessionType);
	const memoryQuery =
		memoryKind === 'parent-agent'
			? parentTaskText(opts)
			: (opts.userContent ?? '');
	const memoryPolicy = memoryTurnPolicy(
		memoryKind,
		cfg.memory,
		process.env.OTTO_MEMORY_AUTO_CAPTURE !== '0',
	);

	const catalog = await buildTurnToolCatalog({
		opts,
		cfg,
		agentCfg,
		discoveredTools: discovered.tools,
		discoveredLazyTools: discovered.lazyToolsRecord,
		sessionType: currentSessionType,
		parentSessionId: currentParentSessionId,
		memoryRelayedByParent: memoryKind === 'parent-agent',
	});
	const { allTools, lazyToolsRecord } = catalog;

	input.toolsTimer.end({
		count:
			allTools.length +
			Object.keys(lazyToolsRecord).length +
			Object.keys(mcpToolsRecord).length,
	});
	throwIfRunAborted(signal);

	const isFirstMessage = !history.some((m) => m.role === 'assistant');

	const systemTimer = time('runner:composeSystemPrompt');
	const prompt = await raceAbort(
		buildRunnerPrompt({
			opts,
			cfg,
			references,
			agentPrompt: `${agentCfg.prompt || ''}${catalog.coordinatorPrompt}`,
			contextSummary: session?.contextSummary ?? undefined,
			historyLength: history.length,
			isFirstMessage,
		}),
		signal,
	);
	await prepareTurnMemory({
		opts,
		cfg,
		db,
		memoryKind,
		memoryQuery,
		memoryPolicy,
		currentParentSessionId,
		additionalSystemMessages: prompt.additionalSystemMessages,
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
		agentTools: [
			...(agentCfg.toolConfig.firstClass || []),
			...catalog.injectedToolNames,
		],
		provider: opts.provider,
		model: opts.model,
		cfg,
		allTools,
	});

	const { model, resolveModelMs, capabilities } = await raceAbort(
		resolveRunnerModel({ opts, cfg }),
		signal,
	);

	const setupToolContextStartedAt = nowMs();
	const { sharedCtx, firstToolTimer, firstToolSeen } = await setupToolContext(
		opts,
		db,
		prompt.referenceRoots,
	);
	const setupToolContextMs = nowMs() - setupToolContextStartedAt;

	const buildToolsetStartedAt = nowMs();
	const providerAuth = await getRunProviderAuth(
		opts.provider,
		opts.projectRoot,
	);
	const toolRegistration = createToolRegistrationMap();
	const toolset = registerRunnerTools({
		tools: gated,
		ctx: sharedCtx,
		provider: opts.provider,
		authType: providerAuth?.type,
		registration: toolRegistration,
	});
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
		...input.timings,
		composeSystemPromptMs: prompt.composeSystemPromptMs,
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
		transport: capabilities.transport,
		timings,
	});
	throwIfRunAborted(signal);

	return {
		cfg,
		db,
		agentCfg,
		history,
		system: prompt.system,
		systemComponents: prompt.systemComponents,
		systemSegments: prompt.systemSegments,
		additionalSystemMessages: prompt.additionalSystemMessages,
		model,
		capabilities,
		maxOutputTokens: prompt.maxOutputTokens,
		effectiveMaxOutputTokens,
		toolset,
		toolRegistration,
		sharedCtx,
		firstToolTimer,
		firstToolSeen,
		providerOptions,
		needsSpoof: prompt.needsSpoof,
		isOpenAIOAuth: prompt.isOpenAIOAuth,
		lazyToolsRecord,
		mcpToolsRecord,
		mcpToolBriefs,
		mcpPreload,
		timings,
	};
}
