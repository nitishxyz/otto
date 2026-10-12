import {
	buildLoadMCPToolsTool,
	convertMCPToolsToAISDK,
	getCachedMCPToolClassifications,
	getMCPManager,
	logger,
	type DiscoveredTool,
} from '@ottocode/sdk';
import type { Tool } from 'ai';
import type { RunOpts } from '../../session/queue.ts';
import {
	buildLazyPrepareStep,
	collectLoadedToolsFromHistory,
	collectLoadedToolsFromSession,
	createLazyPrepareStepState,
	createLazyToolLoaderState,
	type LazyToolLoaderState,
} from '../lazy-prepare-step.ts';
import type { SetupResult } from './runner-setup.ts';
import { getRunProviderAuth } from '../../provider/credentials.ts';
import {
	registerRunnerTools,
	type ToolRegistrationMap,
} from './runner-tool-registration.ts';

type MCPServerSummaryOutput = { connected?: boolean; tools?: unknown[] };

function addConnectedServerTools(
	server: MCPServerSummaryOutput | undefined,
	started: Set<string>,
): void {
	if (!server?.connected || !Array.isArray(server.tools)) return;
	for (const name of server.tools)
		if (typeof name === 'string') started.add(name);
}

function collectStartedMCPToolNames(
	steps: unknown[],
	registration: ToolRegistrationMap,
): Set<string> {
	const started = new Set<string>();
	for (const step of steps as Array<{
		toolResults?: Array<{ toolName: string; output: unknown }>;
	}>) {
		for (const result of step.toolResults ?? []) {
			if (
				registration.registrationToCanonical[result.toolName] !== 'mcp_manager'
			)
				continue;
			const output = result.output as
				| {
						server?: MCPServerSummaryOutput;
						servers?: MCPServerSummaryOutput[];
				  }
				| undefined;
			addConnectedServerTools(output?.server, started);
			for (const server of output?.servers ?? [])
				addConnectedServerTools(server, started);
		}
	}
	return started;
}

function buildMCPToolRefresh(args: {
	projectRoot: string;
	toolset: Record<string, Tool>;
	loader: LazyToolLoaderState;
	registration: ToolRegistrationMap;
	register: (tools: DiscoveredTool[]) => Record<string, Tool>;
}): (refreshArgs: { steps: unknown[] }) => void {
	return ({ steps }) => {
		const manager = getMCPManager(args.projectRoot);
		const liveNames = new Set(
			manager?.started ? manager.getTools().map((entry) => entry.name) : [],
		);
		for (const name of Object.keys(args.loader.toolRecord)) {
			if (liveNames.has(name)) continue;
			const regName = args.loader.canonicalToRegistration[name];
			delete args.loader.toolRecord[name];
			delete args.loader.canonicalToRegistration[name];
			if (regName === undefined) continue;
			args.loader.loadedTools.delete(regName);
			delete args.toolset[regName];
			// Keep the exact inverse reserved for history and in-flight results.
		}
		const freshNames = new Set(
			Array.from(liveNames).filter((name) => !(name in args.loader.toolRecord)),
		);
		if (manager?.started && freshNames.size) {
			const converted = convertMCPToolsToAISDK(
				manager,
				getCachedMCPToolClassifications(args.projectRoot),
			).filter(({ name }) => freshNames.has(name));
			const adapted = args.register(converted);
			Object.assign(args.toolset, adapted);
			for (const { name, tool } of converted) {
				const registered = args.registration.canonicalToRegistration[name];
				if (registered === undefined || !Object.hasOwn(adapted, registered))
					continue;
				args.loader.toolRecord[name] = tool;
				args.loader.canonicalToRegistration[name] = registered;
			}
		}
		for (const name of collectStartedMCPToolNames(steps, args.registration)) {
			const registered = args.loader.canonicalToRegistration[name];
			if (registered !== undefined) args.loader.loadedTools.add(registered);
		}
	};
}

async function createLoaderState(args: {
	record: Record<string, Tool>;
	adapted: Record<string, Tool>;
	registration: ToolRegistrationMap;
	preferredLoadToolName: string;
	collectInitialLoadedTools: (canonicalName: string) => Promise<string[]>;
}): Promise<LazyToolLoaderState> {
	const canonicalToRegistration: Record<string, string> = Object.create(null);
	const acceptedRecord: Record<string, Tool> = Object.create(null);
	for (const [name, tool] of Object.entries(args.record)) {
		const registered = args.registration.canonicalToRegistration[name];
		if (registered === undefined || !Object.hasOwn(args.adapted, registered))
			continue;
		canonicalToRegistration[name] = registered;
		acceptedRecord[name] = tool;
	}
	return createLazyToolLoaderState(
		acceptedRecord,
		canonicalToRegistration,
		args.registration.canonicalToRegistration[args.preferredLoadToolName] ??
			args.preferredLoadToolName,
		await args.collectInitialLoadedTools(args.preferredLoadToolName),
	);
}

export async function setupLazyToolLoading(
	opts: RunOpts,
	setup: SetupResult,
): Promise<{
	toolset: SetupResult['toolset'];
	prepareStep?: ReturnType<typeof buildLazyPrepareStep>;
}> {
	let toolset = setup.toolset;
	const registration = setup.toolRegistration;
	const hasLazyTools = Object.keys(setup.lazyToolsRecord).length > 0;
	const hasMCPTools = Object.keys(setup.mcpToolsRecord).length > 0;
	const canManageMCP =
		registration.canonicalToRegistration.mcp_manager !== undefined ||
		Object.hasOwn(setup.lazyToolsRecord, 'mcp_manager');
	if (!hasLazyTools && !hasMCPTools && !canManageMCP) return { toolset };

	const baseToolNames = Object.keys(toolset);
	const providerAuth = await getRunProviderAuth(
		opts.provider,
		setup.cfg.projectRoot,
	);
	const register = (tools: DiscoveredTool[]) =>
		registerRunnerTools({
			tools,
			ctx: setup.sharedCtx,
			provider: opts.provider,
			authType: providerAuth?.type,
			registration,
		});
	const loaders: LazyToolLoaderState[] = [];
	const collectInitialLoadedTools = async (canonicalName: string) =>
		Array.from(
			new Set([
				...collectLoadedToolsFromHistory(setup.history, canonicalName),
				...(await collectLoadedToolsFromSession(
					setup.db,
					opts.sessionId,
					canonicalName,
				)),
			]),
		);

	if (hasLazyTools) {
		const adaptedLazy = register(
			Object.entries(setup.lazyToolsRecord).map(([name, tool]) => ({
				name,
				tool,
			})),
		);
		toolset = { ...toolset, ...adaptedLazy };
		loaders.push(
			await createLoaderState({
				record: setup.lazyToolsRecord,
				adapted: adaptedLazy,
				registration,
				preferredLoadToolName: 'load_tools',
				collectInitialLoadedTools,
			}),
		);
	}

	let mcpLoader: LazyToolLoaderState | undefined;
	if (hasMCPTools || canManageMCP) {
		const adaptedMCP = hasMCPTools
			? register(
					Object.entries(setup.mcpToolsRecord).map(([name, tool]) => ({
						name,
						tool,
					})),
				)
			: {};
		toolset = { ...toolset, ...adaptedMCP };
		const preload = hasMCPTools ? await setup.mcpPreload.result : null;
		const preloaded = new Set(preload?.selected ?? []);
		if (preloaded.size) {
			const loadToolRegName =
				registration.canonicalToRegistration.load_mcp_tools;
			if (
				loadToolRegName !== undefined &&
				Object.hasOwn(toolset, loadToolRegName)
			) {
				const compact = buildLoadMCPToolsTool(setup.mcpToolBriefs, {
					preloaded,
				});
				const replacement = register([
					{ name: compact.name, tool: compact.tool },
				])[loadToolRegName];
				if (replacement) toolset[loadToolRegName] = replacement;
			}
			logger.debug('[mcp] pre-activated tools for turn', {
				sessionId: opts.sessionId,
				tools: Array.from(preloaded),
			});
		}
		mcpLoader = await createLoaderState({
			record: setup.mcpToolsRecord,
			adapted: adaptedMCP,
			registration,
			preferredLoadToolName: 'load_mcp_tools',
			collectInitialLoadedTools: async (name) => [
				...(await collectInitialLoadedTools(name)),
				...preloaded,
			],
		});
		loaders.push(mcpLoader);
	}
	const refresh = mcpLoader
		? buildMCPToolRefresh({
				projectRoot: setup.cfg.projectRoot,
				toolset,
				loader: mcpLoader,
				registration,
				register,
			})
		: undefined;
	return {
		toolset,
		prepareStep: buildLazyPrepareStep(
			createLazyPrepareStepState(baseToolNames, loaders, refresh),
		),
	};
}
