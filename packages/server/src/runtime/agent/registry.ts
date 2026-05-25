import { getGlobalAgentsJsonPath, getGlobalAgentsDir } from '@ottocode/sdk';
import type { ProviderName } from '@ottocode/sdk';
import { catalog } from '@ottocode/sdk';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveAgentPrompt } from './registry-prompts.ts';

export type AgentConfig = {
	name: string;
	prompt: string;
	tools: string[]; // allowed tool names
	provider?: ProviderName;
	model?: string;
};

export type AgentConfigEntry = {
	tools?: string[];
	appendTools?: string[];
	prompt?: string;
	provider?: string;
	model?: string;
};

type AgentsJson = Record<string, AgentConfigEntry>;

const BUILTIN_AGENT_NAMES = ['build', 'plan', 'general', 'init', 'research'];

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
	const baseTools = normalizeStringList(base?.tools);
	if (baseTools.length) merged.tools = [...baseTools];
	const baseAppend = normalizeStringList(base?.appendTools);
	if (baseAppend.length) merged.appendTools = [...baseAppend];
	if (base && Object.hasOwn(base, 'prompt')) merged.prompt = base.prompt;
	if (base && Object.hasOwn(base, 'provider'))
		merged.provider = normalizeProvider(base.provider);
	if (base && Object.hasOwn(base, 'model'))
		merged.model = normalizeModel(base.model);

	if (Array.isArray(override.tools))
		merged.tools = normalizeStringList(override.tools);
	if (Array.isArray(override.appendTools)) {
		const extras = normalizeStringList(override.appendTools);
		const union = new Set([...(merged.appendTools ?? []), ...extras]);
		merged.appendTools = Array.from(union);
	} else if (
		Object.hasOwn(override, 'appendTools') &&
		!Array.isArray(override.appendTools)
	) {
		delete merged.appendTools;
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

const baseToolSet = ['progress_update', 'finish'] as const;

const defaultToolExtras: Record<string, string[]> = {
	build: [
		'skill',
		'read',
		'read_image',
		'edit',
		'multiedit',
		'write',
		'copy_into',
		'copy_attachment_to_project',
		'ls',
		'tree',
		'shell',
		'update_todos',
		'glob',
		'ripgrep',
		'git_status',
		'terminal',
		'apply_patch',
		'websearch',
	],
	plan: [
		'skill',
		'read',
		'read_image',
		'ls',
		'tree',
		'ripgrep',
		'update_todos',
		'websearch',
	],
	general: [
		'skill',
		'read',
		'read_image',
		'edit',
		'multiedit',
		'write',
		'copy_into',
		'copy_attachment_to_project',
		'ls',
		'tree',
		'shell',
		'ripgrep',
		'glob',
		'websearch',
		'update_todos',
	],
	init: [
		'skill',
		'read',
		'read_image',
		'edit',
		'multiedit',
		'write',
		'copy_into',
		'copy_attachment_to_project',
		'ls',
		'tree',
		'shell',
		'update_todos',
		'glob',
		'ripgrep',
		'git_status',
		'terminal',
		'apply_patch',
		'websearch',
	],
	git: ['git_status', 'git_diff', 'git_commit', 'read', 'ls'],
	commit: ['git_status', 'git_diff', 'git_commit', 'read', 'ls'],
	research: [
		'read',
		'read_image',
		'ls',
		'tree',
		'ripgrep',
		'websearch',
		'update_todos',
		'query_sessions',
		'query_messages',
		'get_session_context',
		'search_history',
		'present_action',
	],
};

export function defaultToolsForAgent(name: string): string[] {
	const extras = defaultToolExtras[name] ? [...defaultToolExtras[name]] : [];
	return Array.from(new Set([...baseToolSet, ...extras]));
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
		tools?: string[];
		provider?: string;
		model?: string;
	},
): Promise<AgentConfig> {
	if (inlineConfig?.prompt) {
		const provider = normalizeProvider(inlineConfig.provider);
		const model = normalizeModel(inlineConfig.model);
		return {
			name,
			prompt: inlineConfig.prompt,
			tools: inlineConfig.tools ?? defaultToolsForAgent(name),
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
	let tools = Array.isArray(entry?.tools)
		? [...(entry?.tools as string[])]
		: defaultToolsForAgent(name);
	if (!entry || !entry.tools) {
		tools = defaultToolsForAgent(name);
	}
	if (Array.isArray(entry?.appendTools) && entry.appendTools.length) {
		for (const t of entry.appendTools) {
			if (typeof t === 'string' && t.trim()) tools.push(t.trim());
		}
	}
	// Deduplicate and ensure base tools are always available
	const deduped = Array.from(new Set([...tools, ...baseToolSet]));
	const provider = normalizeProvider(entry?.provider);
	const model = normalizeModel(entry?.model);
	return {
		name,
		prompt,
		tools: deduped,
		provider,
		model,
	};
}
