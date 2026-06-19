import {
	hasConfiguredProvider,
	loadConfig,
	providerAllowsAnyModel,
	validateProviderModel,
} from '@ottocode/sdk';
import {
	BUILTIN_AGENT_DESCRIPTIONS,
	normalizeAgentDescription,
	type AgentConfigEntry,
} from '../registry.ts';
import { getAgentDetail, isBuiltinAgentName } from './detail.ts';
import {
	configPathForScope,
	readAgentsJson,
	writeAgentsJson,
	writePromptFile,
} from './paths.ts';
import type {
	AgentConfigScope,
	AgentDetail,
	UpsertAgentInput,
} from './types.ts';
import {
	normalizeToolGroups,
	validateAgentName,
	validatePromptSize,
	withRequiredTools,
} from './validation.ts';

function resolveValidationProvider(args: {
	cfg: Awaited<ReturnType<typeof loadConfig>>;
	currentEntry: AgentConfigEntry | undefined;
	input: UpsertAgentInput;
}): string | undefined {
	if (typeof args.input.provider === 'string') {
		return args.input.provider.trim();
	}
	if (args.input.provider === null) return args.cfg.defaults.provider;
	if (typeof args.currentEntry?.provider === 'string') {
		return args.currentEntry.provider.trim();
	}
	return args.cfg.defaults.provider;
}

function applyAgentInputToEntry(args: {
	name: string;
	entry: AgentConfigEntry;
	input: UpsertAgentInput;
	promptReference?: string;
}): AgentConfigEntry {
	const next: AgentConfigEntry = { ...args.entry };
	if (Object.hasOwn(args.input, 'tools') && args.input.tools) {
		next.tools = withRequiredTools(args.input.tools);
	}
	if (Object.hasOwn(args.input, 'appendTools') && args.input.appendTools) {
		next.appendTools = normalizeToolGroups(args.input.appendTools);
	}
	if (args.promptReference !== undefined) {
		next.prompt = args.promptReference;
	} else if (
		typeof args.input.prompt === 'string' &&
		args.input.promptStorage === 'inline'
	) {
		next.prompt = args.input.prompt;
	}
	if (Object.hasOwn(args.input, 'provider')) {
		const provider = args.input.provider;
		if (typeof provider === 'string' && provider.trim()) {
			next.provider = provider.trim();
		} else {
			delete next.provider;
		}
	}
	if (Object.hasOwn(args.input, 'model')) {
		const model = args.input.model;
		if (typeof model === 'string' && model.trim()) {
			next.model = model.trim();
		} else {
			delete next.model;
		}
	}
	if (Object.hasOwn(args.input, 'description')) {
		const normalized = normalizeAgentDescription(args.input.description);
		if (normalized && normalized !== BUILTIN_AGENT_DESCRIPTIONS[args.name]) {
			next.description = normalized;
		} else {
			delete next.description;
		}
	}
	return next;
}

export async function upsertAgentConfig(args: {
	projectRoot: string;
	name: string;
	input: UpsertAgentInput;
}): Promise<AgentDetail> {
	const name = validateAgentName(args.name);
	const scope = args.input.scope ?? 'local';
	const cfg = await loadConfig(args.projectRoot);
	const configPath = configPathForScope(cfg.projectRoot, scope);
	const agents = await readAgentsJson(configPath);
	const currentEntry = agents[name] ?? {};

	if (typeof args.input.provider === 'string') {
		const provider = args.input.provider.trim();
		if (!provider || !hasConfiguredProvider(cfg, provider)) {
			throw new Error(
				`Provider not configured: ${provider || args.input.provider}`,
			);
		}
	}

	if (typeof args.input.model === 'string' && args.input.model.trim()) {
		const provider = resolveValidationProvider({
			cfg,
			currentEntry,
			input: args.input,
		});
		if (!provider || !hasConfiguredProvider(cfg, provider)) {
			throw new Error('A configured provider is required to validate model.');
		}
		validateProviderModel(provider, args.input.model, cfg, {
			allowUnknownModel: providerAllowsAnyModel(cfg, provider),
		});
	}

	let promptReference: string | undefined;
	if (typeof args.input.prompt === 'string') {
		validatePromptSize(args.input.prompt);
		if (args.input.promptStorage === 'inline') {
			promptReference = undefined;
		} else {
			promptReference = await writePromptFile({
				projectRoot: cfg.projectRoot,
				scope,
				name,
				prompt: args.input.prompt,
			});
		}
	}

	agents[name] = applyAgentInputToEntry({
		name,
		entry: currentEntry,
		input: args.input,
		promptReference,
	});
	await writeAgentsJson(configPath, agents);
	return getAgentDetail(cfg.projectRoot, name);
}

export async function deleteAgentConfig(args: {
	projectRoot: string;
	name: string;
	scope?: AgentConfigScope;
}): Promise<{ deleted: boolean; builtin: boolean; agent?: AgentDetail }> {
	const name = validateAgentName(args.name);
	const scope = args.scope ?? 'local';
	const cfg = await loadConfig(args.projectRoot);
	const configPath = configPathForScope(cfg.projectRoot, scope);
	const agents = await readAgentsJson(configPath);
	const deleted = Object.hasOwn(agents, name);
	if (deleted) {
		delete agents[name];
		await writeAgentsJson(configPath, agents);
	}
	const builtin = isBuiltinAgentName(name);
	return {
		deleted,
		builtin,
		agent: builtin ? await getAgentDetail(cfg.projectRoot, name) : undefined,
	};
}
