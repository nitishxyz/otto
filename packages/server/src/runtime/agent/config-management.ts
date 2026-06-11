import {
	getGlobalAgentsDir,
	getGlobalAgentsJsonPath,
	hasConfiguredProvider,
	loadConfig,
	providerAllowsAnyModel,
	validateProviderModel,
} from '@ottocode/sdk';
import type { OttoConfig } from '@ottocode/sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
	BUILTIN_AGENT_NAMES,
	BUILTIN_AGENT_DESCRIPTIONS,
	defaultToolConfigForAgent,
	discoverAllAgents,
	loadAgentsConfig,
	normalizeAgentDescription,
	resolveAgentConfig,
	type AgentConfigEntry,
	type AgentToolConfig,
	type AgentToolGroups,
	type AgentsJson,
} from './registry.ts';
import { resolveAgentPrompt } from './registry-prompts.ts';

export type AgentConfigScope = 'local' | 'global';

export type AgentDetailSource =
	| 'builtin'
	| 'local'
	| 'global'
	| 'merged'
	| 'embedded';

export type AgentDetail = {
	name: string;
	builtin: boolean;
	custom: boolean;
	source: AgentDetailSource;
	prompt: string;
	promptSource: string;
	description?: string;
	defaultDescription?: string;
	toolConfig: Required<AgentToolGroups>;
	defaultToolConfig: Required<AgentToolGroups>;
	appendToolConfig: AgentToolGroups;
	provider?: string;
	model?: string;
	editable: boolean;
	hasLocalOverride: boolean;
	hasGlobalOverride: boolean;
};

export type UpsertAgentInput = {
	scope?: AgentConfigScope;
	prompt?: string;
	promptStorage?: 'file' | 'inline';
	description?: string | null;
	tools?: AgentToolConfig;
	appendTools?: AgentToolConfig;
	provider?: string | null;
	model?: string | null;
};

const REQUIRED_AGENT_TOOLS = ['progress_update', 'load_tools'] as const;
const MAX_PROMPT_BYTES = 256 * 1024;
const AGENT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/');
}

function localAgentsJsonPath(projectRoot: string): string {
	return normalizePath(`${projectRoot}/.otto/agents.json`);
}

function configPathForScope(
	projectRoot: string,
	scope: AgentConfigScope,
): string {
	return scope === 'global'
		? getGlobalAgentsJsonPath()
		: localAgentsJsonPath(projectRoot);
}

async function readAgentsJson(path: string): Promise<AgentsJson> {
	try {
		const file = Bun.file(path);
		if (!(await file.exists())) return {};
		const parsed = await file.json();
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as AgentsJson;
		}
	} catch {}
	return {};
}

async function writeAgentsJson(
	path: string,
	agents: AgentsJson,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(agents, null, 2)}\n`, 'utf8');
}

export async function loadAgentConfigLayers(projectRoot: string): Promise<{
	global: AgentsJson;
	local: AgentsJson;
	merged: AgentsJson;
}> {
	const [globalCfg, localCfg, merged] = await Promise.all([
		readAgentsJson(getGlobalAgentsJsonPath()),
		readAgentsJson(localAgentsJsonPath(projectRoot)),
		loadAgentsConfig(projectRoot),
	]);
	return { global: globalCfg, local: localCfg, merged };
}

export function validateAgentName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Agent name is required.');
	if (trimmed !== name) {
		throw new Error(
			'Agent name cannot contain leading or trailing whitespace.',
		);
	}
	if (!AGENT_NAME_PATTERN.test(trimmed)) {
		throw new Error(
			'Agent name may only contain letters, numbers, underscores, and dashes.',
		);
	}
	if (trimmed.includes('..')) {
		throw new Error('Agent name cannot contain path traversal segments.');
	}
	return trimmed;
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') continue;
		const trimmed = item.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

function normalizeToolGroups(value: unknown): AgentToolGroups | undefined {
	if (!value || typeof value !== 'object') return undefined;
	if (Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const firstClass = normalizeStringList(record.firstClass);
	const loadable = normalizeStringList(record.loadable);
	return firstClass.length || loadable.length
		? { firstClass, loadable }
		: undefined;
}

function withRequiredTools(tools: AgentToolConfig): AgentToolGroups {
	const groups = normalizeToolGroups(tools) ?? {};
	return {
		firstClass: Array.from(
			new Set([...(groups.firstClass ?? []), ...REQUIRED_AGENT_TOOLS]),
		),
		loadable: Array.from(new Set(groups.loadable ?? [])),
	};
}

function isBuiltinAgent(name: string): boolean {
	return BUILTIN_AGENT_NAMES.includes(name);
}

function isLocalPromptSource(projectRoot: string, source: string): boolean {
	return normalizePath(source).includes(
		normalizePath(`${projectRoot}/.otto/agents`),
	);
}

function isGlobalPromptSource(source: string): boolean {
	return normalizePath(source).includes(normalizePath(getGlobalAgentsDir()));
}

function getAgentSource(args: {
	name: string;
	hasLocalEntry: boolean;
	hasGlobalEntry: boolean;
	hasLocalPrompt: boolean;
	hasGlobalPrompt: boolean;
	promptSource: string;
}): AgentDetailSource {
	const hasLocal = args.hasLocalEntry || args.hasLocalPrompt;
	const hasGlobal = args.hasGlobalEntry || args.hasGlobalPrompt;
	if (hasLocal && hasGlobal) return 'merged';
	if (hasLocal) return 'local';
	if (hasGlobal) return 'global';
	if (args.promptSource.startsWith('fallback:embedded:')) return 'embedded';
	if (isBuiltinAgent(args.name)) return 'builtin';
	return 'embedded';
}

export async function getAgentDetail(
	projectRoot: string,
	nameInput: string,
): Promise<AgentDetail> {
	const name = validateAgentName(nameInput);
	const layers = await loadAgentConfigLayers(projectRoot);
	const entry = layers.merged[name];
	const agentCfg = await resolveAgentConfig(projectRoot, name);
	const promptResolution = await resolveAgentPrompt({
		projectRoot,
		name,
		entryPrompt: entry?.prompt,
	});
	const hasLocalEntry = Object.hasOwn(layers.local, name);
	const hasGlobalEntry = Object.hasOwn(layers.global, name);
	const hasLocalPrompt = isLocalPromptSource(
		projectRoot,
		promptResolution.source,
	);
	const hasGlobalPrompt = isGlobalPromptSource(promptResolution.source);
	const builtin = isBuiltinAgent(name);

	return {
		name,
		builtin,
		custom: !builtin,
		source: getAgentSource({
			name,
			hasLocalEntry,
			hasGlobalEntry,
			hasLocalPrompt,
			hasGlobalPrompt,
			promptSource: promptResolution.source,
		}),
		prompt: promptResolution.prompt,
		promptSource: promptResolution.source,
		description: agentCfg.description,
		defaultDescription: BUILTIN_AGENT_DESCRIPTIONS[name],
		toolConfig: agentCfg.toolConfig,
		defaultToolConfig: defaultToolConfigForAgent(name),
		appendToolConfig: normalizeToolGroups(entry?.appendTools) ?? {},
		provider: agentCfg.provider,
		model: agentCfg.model,
		editable: true,
		hasLocalOverride: hasLocalEntry || hasLocalPrompt,
		hasGlobalOverride: hasGlobalEntry || hasGlobalPrompt,
	};
}

export async function getAllAgentDetails(projectRoot: string): Promise<{
	agents: AgentDetail[];
	default: string;
}> {
	const cfg = await loadConfig(projectRoot);
	const names = await discoverAllAgents(cfg.projectRoot);
	const agents = await Promise.all(
		names.map((name) => getAgentDetail(cfg.projectRoot, name)),
	);
	return {
		agents: agents.sort((a, b) => a.name.localeCompare(b.name)),
		default: cfg.defaults.agent,
	};
}

function validatePromptSize(prompt: string): void {
	if (new TextEncoder().encode(prompt).byteLength > MAX_PROMPT_BYTES) {
		throw new Error('Agent prompt is too large. Maximum size is 256 KB.');
	}
}

function getPromptFileTarget(args: {
	projectRoot: string;
	scope: AgentConfigScope;
	name: string;
}): { filePath: string; configReference: string } {
	if (args.scope === 'global') {
		const filePath = normalizePath(
			join(getGlobalAgentsDir(), args.name, 'agent.md'),
		);
		return { filePath, configReference: filePath };
	}
	const configReference = normalizePath(`.otto/agents/${args.name}/agent.md`);
	return {
		filePath: normalizePath(join(args.projectRoot, configReference)),
		configReference,
	};
}

async function writePromptFile(args: {
	projectRoot: string;
	scope: AgentConfigScope;
	name: string;
	prompt: string;
}): Promise<string> {
	const target = getPromptFileTarget(args);
	await mkdir(dirname(target.filePath), { recursive: true });
	await writeFile(target.filePath, args.prompt, 'utf8');
	return target.configReference;
}

function resolveValidationProvider(args: {
	cfg: OttoConfig;
	currentEntry: AgentConfigEntry | undefined;
	input: UpsertAgentInput;
}): string | undefined {
	if (typeof args.input.provider === 'string')
		return args.input.provider.trim();
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
	const builtin = isBuiltinAgent(name);
	return {
		deleted,
		builtin,
		agent: builtin ? await getAgentDetail(cfg.projectRoot, name) : undefined,
	};
}
