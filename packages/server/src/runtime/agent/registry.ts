import { getGlobalAgentsJsonPath, getGlobalAgentsDir } from '@ottocode/sdk';
import type { ProviderName } from '@ottocode/sdk';
import { catalog } from '@ottocode/sdk';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveAgentPrompt } from './registry-prompts.ts';

export type AgentConfig = {
	name: string;
	prompt: string;
	toolConfig: Required<AgentToolGroups>;
	provider?: ProviderName;
	model?: string;
};

export type AgentToolGroups = {
	firstClass?: string[];
	loadable?: string[];
};

export type AgentToolConfig = AgentToolGroups;

export type AgentConfigEntry = {
	tools?: AgentToolConfig;
	appendTools?: AgentToolConfig;
	prompt?: string;
	provider?: string;
	model?: string;
};

export type AgentsJson = Record<string, AgentConfigEntry>;

export const BUILTIN_AGENT_NAMES = [
	'build',
	'plan',
	'general',
	'init',
	'research',
];

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

export function normalizeAgentToolConfig(
	value: unknown,
): Required<AgentToolGroups> | undefined {
	if (!value || typeof value !== 'object') return undefined;
	if (Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const firstClass = normalizeStringList(record.firstClass);
	const loadable = normalizeStringList(record.loadable);
	return firstClass.length || loadable.length
		? { firstClass, loadable }
		: undefined;
}

export function flattenAgentToolConfig(
	groups: AgentToolGroups | undefined,
): string[] {
	if (!groups) return [];
	return Array.from(
		new Set([...(groups.firstClass ?? []), ...(groups.loadable ?? [])]),
	);
}

function normalizeRequiredToolGroups(
	groups: AgentToolGroups,
): Required<AgentToolGroups> {
	return {
		firstClass: Array.from(
			new Set([...(groups.firstClass ?? []), ...baseToolSet]),
		),
		loadable: Array.from(new Set(groups.loadable ?? [])),
	};
}

function mergeToolGroups(
	base: AgentToolGroups | undefined,
	extra: AgentToolGroups | undefined,
): AgentToolGroups | undefined {
	if (!base && !extra) return undefined;
	const firstClass = Array.from(
		new Set([...(base?.firstClass ?? []), ...(extra?.firstClass ?? [])]),
	);
	const loadable = Array.from(
		new Set([...(base?.loadable ?? []), ...(extra?.loadable ?? [])]),
	);
	return { firstClass, loadable };
}

const providerValues = new Set<ProviderName>(
	Object.keys(catalog) as ProviderName[],
);

function normalizeProvider(value: unknown): ProviderName | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) return undefined;
	return providerValues.has(trimmed as ProviderName)
		? (trimmed as ProviderName)
		: undefined;
}

function normalizeModel(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
}

function mergeAgentEntries(
	base: AgentConfigEntry | undefined,
	override: AgentConfigEntry,
): AgentConfigEntry {
	const merged: AgentConfigEntry = {};
	const baseTools = normalizeAgentToolConfig(base?.tools);
	if (baseTools) merged.tools = baseTools;
	const baseAppend = normalizeAgentToolConfig(base?.appendTools);
	if (baseAppend) merged.appendTools = baseAppend;
	if (base && Object.hasOwn(base, 'prompt')) merged.prompt = base.prompt;
	if (base && Object.hasOwn(base, 'provider'))
		merged.provider = normalizeProvider(base.provider);
	if (base && Object.hasOwn(base, 'model'))
		merged.model = normalizeModel(base.model);

	if (Object.hasOwn(override, 'tools')) {
		const normalized = normalizeAgentToolConfig(override.tools);
		if (normalized) merged.tools = normalized;
		else delete merged.tools;
	}
	if (Object.hasOwn(override, 'appendTools')) {
		const extras = normalizeAgentToolConfig(override.appendTools);
		const union = mergeToolGroups(
			normalizeAgentToolConfig(merged.appendTools),
			extras,
		);
		if (union) merged.appendTools = union;
		else delete merged.appendTools;
	}
	if (Object.hasOwn(override, 'prompt')) merged.prompt = override.prompt;

	if (Object.hasOwn(override, 'provider')) {
		const normalized = normalizeProvider(override.provider);
		if (normalized) merged.provider = normalized;
		else delete merged.provider;
	}
	if (Object.hasOwn(override, 'model')) {
		const normalized = normalizeModel(override.model);
		if (normalized) merged.model = normalized;
		else delete merged.model;
	}
	return merged;
}

const baseToolSet = ['progress_update', 'finish', 'load_tools'] as const;

const defaultToolExtras: Record<string, AgentToolGroups> = {
	build: {
		firstClass: [
			'skill',
			'read',
			'edit',
			'multiedit',
			'write',
			'copy_into',
			'ls',
			'tree',
			'shell',
			'update_todos',
			'glob',
			'search',
			'git_status',
			'terminal',
			'apply_patch',
			'websearch',
		],
		loadable: ['read_image', 'copy_attachment_to_project', 'simulator'],
	},
	plan: {
		firstClass: [
			'skill',
			'read',
			'ls',
			'tree',
			'search',
			'update_todos',
			'websearch',
		],
		loadable: ['read_image'],
	},
	general: {
		firstClass: [
			'skill',
			'read',
			'ls',
			'tree',
			'shell',
			'search',
			'glob',
			'websearch',
			'update_todos',
		],
	},
	init: {
		firstClass: [
			'skill',
			'read',
			'edit',
			'multiedit',
			'write',
			'copy_into',
			'ls',
			'tree',
			'shell',
			'update_todos',
			'glob',
			'search',
			'git_status',
			'apply_patch',
			'websearch',
		],
		loadable: ['read_image'],
	},
	git: { firstClass: ['git_status', 'git_diff', 'git_commit', 'read', 'ls'] },
	commit: {
		firstClass: ['git_status', 'git_diff', 'git_commit', 'read', 'ls'],
	},
	research: {
		firstClass: [
			'read',
			'ls',
			'tree',
			'search',
			'websearch',
			'update_todos',
			'query_sessions',
			'query_messages',
			'get_session_context',
			'search_history',
			'present_action',
		],
		loadable: ['read_image', 'copy_attachment_to_project'],
	},
};

export function defaultToolConfigForAgent(
	name: string,
): Required<AgentToolGroups> {
	const extras = defaultToolExtras[name];
	return normalizeRequiredToolGroups(extras ?? {});
}

export async function loadAgentsConfig(
	projectRoot: string,
): Promise<AgentsJson> {
	const localPath = `${projectRoot}/.otto/agents.json`.replace(/\\/g, '/');
	const globalPath = getGlobalAgentsJsonPath();
	let globalCfg: AgentsJson = {};
	let localCfg: AgentsJson = {};
	try {
		const gf = Bun.file(globalPath);
		if (await gf.exists())
			globalCfg = (await gf.json().catch(() => ({}))) as AgentsJson;
	} catch {}
	try {
		const lf = Bun.file(localPath);
		if (await lf.exists())
			localCfg = (await lf.json().catch(() => ({}))) as AgentsJson;
	} catch {}
	const merged: AgentsJson = {};
	for (const [name, entry] of Object.entries(globalCfg)) {
		merged[name] = mergeAgentEntries(undefined, entry ?? {});
	}
	for (const [name, entry] of Object.entries(localCfg)) {
		const base = merged[name];
		merged[name] = mergeAgentEntries(base, entry ?? {});
	}
	return merged;
}

export async function discoverAllAgents(
	projectRoot: string,
): Promise<string[]> {
	const agentSet = new Set<string>(BUILTIN_AGENT_NAMES);

	try {
		const agentsJson = await loadAgentsConfig(projectRoot);
		for (const agentName of Object.keys(agentsJson)) {
			if (agentName.trim()) {
				agentSet.add(agentName);
			}
		}
	} catch {}

	try {
		const localAgentsPath = join(projectRoot, '.otto', 'agents');
		const localFiles = await readdir(localAgentsPath).catch(() => []);
		for (const file of localFiles) {
			if (file.endsWith('.txt') || file.endsWith('.md')) {
				const agentName = file.replace(/\.(txt|md)$/, '');
				if (agentName.trim()) {
					agentSet.add(agentName);
				}
			}
		}
	} catch {}

	try {
		const globalAgentsPath = getGlobalAgentsDir();
		const globalFiles = await readdir(globalAgentsPath).catch(() => []);
		for (const file of globalFiles) {
			if (file.endsWith('.txt') || file.endsWith('.md')) {
				const agentName = file.replace(/\.(txt|md)$/, '');
				if (agentName.trim()) {
					agentSet.add(agentName);
				}
			}
		}
	} catch {}

	return Array.from(agentSet).sort();
}

export async function resolveAgentConfig(
	projectRoot: string,
	name: string,
	inlineConfig?: {
		prompt?: string;
		tools?: AgentToolConfig;
		provider?: string;
		model?: string;
	},
): Promise<AgentConfig> {
	if (inlineConfig?.prompt) {
		const provider = normalizeProvider(inlineConfig.provider);
		const model = normalizeModel(inlineConfig.model);
		const toolConfig = normalizeRequiredToolGroups(
			normalizeAgentToolConfig(inlineConfig.tools) ??
				defaultToolConfigForAgent(name),
		);
		return {
			name,
			prompt: inlineConfig.prompt,
			toolConfig,
			provider,
			model,
		};
	}
	const agents = await loadAgentsConfig(projectRoot);
	const entry = agents[name];
	const { prompt } = await resolveAgentPrompt({
		projectRoot,
		name,
		entryPrompt: entry?.prompt,
	});

	// Default tool access per agent if not explicitly configured
	let toolConfig: AgentToolGroups | undefined = entry?.tools
		? normalizeAgentToolConfig(entry.tools)
		: defaultToolConfigForAgent(name);
	if (!entry || !entry.tools) {
		toolConfig = defaultToolConfigForAgent(name);
	}
	const appendTools = normalizeAgentToolConfig(entry?.appendTools);
	if (appendTools) {
		toolConfig = mergeToolGroups(toolConfig, appendTools) ?? toolConfig;
	}
	const normalizedToolConfig = normalizeRequiredToolGroups(toolConfig ?? {});
	const provider = normalizeProvider(entry?.provider);
	const model = normalizeModel(entry?.model);
	return {
		name,
		prompt,
		toolConfig: normalizedToolConfig,
		provider,
		model,
	};
}
