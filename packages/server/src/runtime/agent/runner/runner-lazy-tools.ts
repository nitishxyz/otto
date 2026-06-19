import { getAuth } from '@ottocode/sdk';
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

	if (!hasLazyTools && !hasMCPTools) {
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

	if (hasMCPTools) {
		const adaptedMCP = adaptToolsFn(
			Object.entries(setup.mcpToolsRecord).map(([name, tool]) => ({
				name,
				tool,
			})),
			setup.sharedCtx,
			opts.provider,
			providerAuth?.type,
		);
		toolset = { ...toolset, ...adaptedMCP };
		loaders.push(
			await createLoaderState({
				record: setup.mcpToolsRecord,
				adapted: adaptedMCP,
				toolset,
				preferredLoadToolName: 'load_mcp_tools',
				collectInitialLoadedTools,
			}),
		);
	}

	return {
		toolset,
		prepareStep: buildLazyPrepareStep(
			createLazyPrepareStepState(baseToolNames, loaders),
		),
	};
}
