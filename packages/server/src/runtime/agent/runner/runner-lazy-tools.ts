import { convertMCPToolsToAISDK, getAuth, getMCPManager } from '@ottocode/sdk';
import type { Tool } from 'ai';
import { adaptTools as adaptToolsFn } from '../../../tools/adapter.ts';
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

function normalizeToolName(name: string): string {
	return name.toLowerCase().replace(/_/g, '');
}

type MCPServerSummaryOutput = {
	connected?: boolean;
	tools?: unknown[];
};

function addConnectedServerTools(
	server: MCPServerSummaryOutput | undefined,
	started: Set<string>,
): void {
	if (!server?.connected || !Array.isArray(server.tools)) return;
	for (const name of server.tools) {
		if (typeof name === 'string') started.add(name);
	}
}

function collectStartedMCPToolNames(steps: unknown[]): Set<string> {
	const started = new Set<string>();
	const previousSteps = steps as Array<{
		toolResults?: Array<{ toolName: string; output: unknown }>;
	}>;
	for (const step of previousSteps) {
		for (const result of step.toolResults ?? []) {
			if (normalizeToolName(result.toolName) !== 'mcpmanager') continue;
			const output = result.output as
				| {
						server?: MCPServerSummaryOutput;
						servers?: MCPServerSummaryOutput[];
				  }
				| undefined;
			addConnectedServerTools(output?.server, started);
			for (const server of output?.servers ?? []) {
				addConnectedServerTools(server, started);
			}
		}
	}
	return started;
}

function buildMCPToolRefresh(args: {
	projectRoot: string;
	toolset: Record<string, Tool>;
	loader: LazyToolLoaderState;
	sharedCtx: SetupResult['sharedCtx'];
	provider: string;
	authType?: string;
}): (refreshArgs: { steps: unknown[] }) => void {
	return ({ steps }) => {
		const manager = getMCPManager(args.projectRoot);
		if (!manager?.started) return;

		const freshNames = manager
			.getTools()
			.map((entry) => entry.name)
			.filter((name) => !(name in args.loader.toolRecord));
		if (freshNames.length > 0) {
			const freshSet = new Set(freshNames);
			const converted = convertMCPToolsToAISDK(manager).filter(({ name }) =>
				freshSet.has(name),
			);
			const adapted = adaptToolsFn(
				converted,
				args.sharedCtx,
				args.provider,
				args.authType,
			);
			Object.assign(args.toolset, adapted);
			const registrationKeys = Object.keys(adapted);
			for (const { name, tool } of converted) {
				args.loader.toolRecord[name] = tool;
				const normalized = normalizeToolName(name);
				args.loader.canonicalToRegistration[name] =
					registrationKeys.find(
						(k) => k === name || normalizeToolName(k) === normalized,
					) ?? name;
			}
		}

		for (const name of collectStartedMCPToolNames(steps)) {
			const regName = args.loader.canonicalToRegistration[name];
			if (regName) args.loader.loadedTools.add(regName);
		}
	};
}

function buildCanonicalRegistrationMap(
	canonicalRecord: Record<string, unknown>,
	adaptedRecord: Record<string, unknown>,
): Record<string, string> {
	const registrationKeys = Object.keys(adaptedRecord);
	const canonicalToRegistration: Record<string, string> = {};
	for (const canonical of Object.keys(canonicalRecord)) {
		const normalizedCanonical = normalizeToolName(canonical);
		const regName = registrationKeys.find(
			(k) => k === canonical || normalizeToolName(k) === normalizedCanonical,
		);
		canonicalToRegistration[canonical] = regName ?? canonical;
	}
	return canonicalToRegistration;
}

function findLoadToolRegistrationName(
	toolset: Record<string, unknown>,
	preferredName: string,
): string {
	const normalized = normalizeToolName(preferredName);
	return (
		Object.keys(toolset).find(
			(k) => k === preferredName || normalizeToolName(k) === normalized,
		) ?? preferredName
	);
}

async function createLoaderState(args: {
	record: Record<string, Tool>;
	adapted: Record<string, unknown>;
	toolset: Record<string, unknown>;
	preferredLoadToolName: string;
	collectInitialLoadedTools: (loadToolRegName: string) => Promise<string[]>;
}): Promise<LazyToolLoaderState> {
	const canonicalToRegistration = buildCanonicalRegistrationMap(
		args.record,
		args.adapted,
	);
	const loadToolRegName = findLoadToolRegistrationName(
		args.toolset,
		args.preferredLoadToolName,
	);
	return createLazyToolLoaderState(
		args.record,
		canonicalToRegistration,
		loadToolRegName,
		await args.collectInitialLoadedTools(loadToolRegName),
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
	const hasLazyTools = Object.keys(setup.lazyToolsRecord).length > 0;
	const hasMCPTools = Object.keys(setup.mcpToolsRecord).length > 0;
	const canManageMCP = [
		...Object.keys(toolset),
		...Object.keys(setup.lazyToolsRecord),
	].some((name) => normalizeToolName(name) === 'mcpmanager');

	if (!hasLazyTools && !hasMCPTools && !canManageMCP) {
		return { toolset };
	}

	const baseToolNames = Object.keys(toolset);
	const providerAuth = await getAuth(opts.provider, setup.cfg.projectRoot);
	const loaders: LazyToolLoaderState[] = [];
	const collectInitialLoadedTools = async (loadToolRegName: string) =>
		Array.from(
			new Set([
				...collectLoadedToolsFromHistory(setup.history, loadToolRegName),
				...(await collectLoadedToolsFromSession(
					setup.db,
					opts.sessionId,
					loadToolRegName,
				)),
			]),
		);

	if (hasLazyTools) {
		const adaptedLazy = adaptToolsFn(
			Object.entries(setup.lazyToolsRecord).map(([name, tool]) => ({
				name,
				tool,
			})),
			setup.sharedCtx,
			opts.provider,
			providerAuth?.type,
		);
		toolset = { ...toolset, ...adaptedLazy };
		loaders.push(
			await createLoaderState({
				record: setup.lazyToolsRecord,
				adapted: adaptedLazy,
				toolset,
				preferredLoadToolName: 'load_tools',
				collectInitialLoadedTools,
			}),
		);
	}

	let mcpLoader: LazyToolLoaderState | undefined;
	if (hasMCPTools || canManageMCP) {
		const adaptedMCP = hasMCPTools
			? adaptToolsFn(
					Object.entries(setup.mcpToolsRecord).map(([name, tool]) => ({
						name,
						tool,
					})),
					setup.sharedCtx,
					opts.provider,
					providerAuth?.type,
				)
			: {};
		if (hasMCPTools) {
			toolset = { ...toolset, ...adaptedMCP };
		}
		mcpLoader = await createLoaderState({
			record: setup.mcpToolsRecord,
			adapted: adaptedMCP,
			toolset,
			preferredLoadToolName: 'load_mcp_tools',
			collectInitialLoadedTools,
		});
		loaders.push(mcpLoader);
	}

	const refresh = mcpLoader
		? buildMCPToolRefresh({
				projectRoot: setup.cfg.projectRoot,
				toolset,
				loader: mcpLoader,
				sharedCtx: setup.sharedCtx,
				provider: opts.provider,
				authType: providerAuth?.type,
			})
		: undefined;

	return {
		toolset,
		prepareStep: buildLazyPrepareStep(
			createLazyPrepareStepState(baseToolNames, loaders, refresh),
		),
	};
}
