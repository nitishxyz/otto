import {
	buildLoadToolsTool,
	getLazyToolDefinitions,
	getToolMetadata,
	isDelegatableAgent,
	type DiscoveredTool,
	type loadConfig,
} from '@ottocode/sdk';
import type { Tool } from 'ai';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import COORDINATOR_PROMPT from '@ottocode/sdk/prompts/coordinator.txt' with {
	type: 'text',
};
import { buildDatabaseTools } from '../../../tools/database/index.ts';
import { buildSubagentTools } from '../../../tools/subagents/index.ts';
import { buildMemoryTools } from '../../../tools/memory.ts';
import { buildConfiguredServerTools } from '../../../tools/lazy.ts';
import { buildExplicitAgentMentionContext } from '../../prompt/agent-mentions.ts';
import type { RunOpts } from '../../session/queue.ts';
import {
	flattenAgentToolConfig,
	type resolveAgentConfig,
} from '../registry.ts';

const DATABASE_TOOL_NAMES = new Set([
	'query_sessions',
	'query_messages',
	'get_session_context',
	'search_history',
	'present_action',
]);

// Subagents cannot delegate further (depth-1 delegation cap).
const NO_DELEGATION_SESSION_TYPES = new Set(['subagent']);

export type TurnToolCatalog = {
	allTools: DiscoveredTool[];
	lazyToolsRecord: Record<string, Tool>;
	injectedToolNames: string[];
	coordinatorPrompt: string;
};

async function buildCoordinatorPrompt(
	opts: RunOpts,
	projectRoot: string,
): Promise<string> {
	let coordinatorPrompt = `\n\n${COORDINATOR_PROMPT.trim()}`;
	try {
		const { listAgentDescriptions } = await import('../registry.ts');
		const agentList = await listAgentDescriptions(projectRoot);
		const delegatable = agentList.filter((a) => isDelegatableAgent(a.name));
		const lines = delegatable.map((a) =>
			a.description ? `- ${a.name}: ${a.description}` : `- ${a.name}`,
		);
		if (lines.length) {
			coordinatorPrompt += [
				'',
				'',
				'### Available agents (subagent action=delegate)',
				'',
				...lines,
			].join('\n');
		}
		const agentMentionContext = buildExplicitAgentMentionContext({
			content: opts.userContent,
			agents: delegatable,
		});
		if (agentMentionContext) {
			coordinatorPrompt += `\n\n${agentMentionContext}`;
		}
	} catch {}
	return coordinatorPrompt;
}

/**
 * Assembles the tool catalog for a turn: discovered tools plus injected
 * database, memory, and delegation tools, and the lazily loadable set exposed
 * through `load_tools`.
 */
export async function buildTurnToolCatalog(args: {
	opts: RunOpts;
	cfg: Awaited<ReturnType<typeof loadConfig>>;
	agentCfg: Awaited<ReturnType<typeof resolveAgentConfig>>;
	discoveredTools: DiscoveredTool[];
	discoveredLazyTools: Record<string, Tool>;
	sessionType: string;
	parentSessionId: string | null;
	memoryRelayedByParent: boolean;
}): Promise<TurnToolCatalog> {
	const { opts, cfg, agentCfg } = args;
	let allTools = args.discoveredTools;
	let lazyToolsRecord = args.discoveredLazyTools;
	const injectedToolNames: string[] = [];

	const configuredToolNames = new Set(
		flattenAgentToolConfig(agentCfg.toolConfig),
	);
	const needsDatabaseTools =
		opts.agent === 'research' ||
		Array.from(configuredToolNames).some((name) =>
			DATABASE_TOOL_NAMES.has(name),
		);
	if (needsDatabaseTools) {
		allTools.push(...buildDatabaseTools(cfg.projectRoot, args.parentSessionId));
	}

	if (cfg.memory?.enabled !== false) {
		for (const item of buildMemoryTools(
			{ projectRoot: cfg.projectRoot, sessionId: opts.sessionId },
			cfg.judge,
			cfg.memory,
			args.parentSessionId
				? {
						agent: opts.agent,
						parentSessionId: args.parentSessionId,
						relayedByParent: args.memoryRelayedByParent,
					}
				: undefined,
		)) {
			allTools.push(item);
			injectedToolNames.push(item.name);
		}
	}

	// Delegation tools and coordinator guidance are built-in for every agent in
	// eligible sessions; no per-agent tool configuration is required.
	let coordinatorPrompt = '';
	if (!NO_DELEGATION_SESSION_TYPES.has(args.sessionType)) {
		for (const item of buildSubagentTools(cfg.projectRoot, opts.sessionId)) {
			allTools.push(item);
			injectedToolNames.push(item.name);
		}
		coordinatorPrompt = await buildCoordinatorPrompt(opts, cfg.projectRoot);
	}

	const configuredLoadableNames = new Set(agentCfg.toolConfig.loadable ?? []);
	const configuredServerTools = buildConfiguredServerTools({
		projectRoot: cfg.projectRoot,
		firstClassNames: agentCfg.toolConfig.firstClass ?? [],
		loadableNames: configuredLoadableNames,
	});
	for (const item of configuredServerTools.firstClass) {
		allTools.push({ name: item.name, tool: item.tool });
	}
	for (const item of configuredServerTools.loadable) {
		lazyToolsRecord[item.name] = item.tool;
	}
	for (const toolItem of allTools) {
		if (!configuredLoadableNames.has(toolItem.name)) continue;
		if (toolItem.name === 'load_tools' || toolItem.name === 'load_mcp_tools')
			continue;
		lazyToolsRecord[toolItem.name] = toolItem.tool;
	}

	const allowedLazyToolNames = Object.keys(lazyToolsRecord).filter(
		(name) =>
			configuredLoadableNames.has(name) ||
			getToolMetadata(lazyToolsRecord[name])?.source === 'extension',
	);
	if (
		allowedLazyToolNames.length !== Object.keys(lazyToolsRecord).length ||
		configuredServerTools.loadable.length > 0
	) {
		lazyToolsRecord = Object.fromEntries(
			allowedLazyToolNames.map((name) => [name, lazyToolsRecord[name]]),
		) as Record<string, Tool>;
		const lazyDescriptions = new Map(
			getLazyToolDefinitions().map(({ name, description }) => [
				name,
				description,
			]),
		);
		for (const item of configuredServerTools.loadable) {
			if (!allowedLazyToolNames.includes(item.name)) continue;
			lazyDescriptions.set(item.name, item.description);
		}
		const lazyBriefs = allowedLazyToolNames.map((name) => ({
			name,
			description:
				lazyDescriptions.get(name) ??
				(typeof lazyToolsRecord[name]?.description === 'string'
					? lazyToolsRecord[name].description
					: `Load ${name}`),
		}));
		const loadTools = buildLoadToolsTool(lazyBriefs);
		allTools = allTools.map((item) =>
			item.name === loadTools.name ? loadTools : item,
		);
	}

	return { allTools, lazyToolsRecord, injectedToolNames, coordinatorPrompt };
}
