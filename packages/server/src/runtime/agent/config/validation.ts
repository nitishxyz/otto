import type { AgentToolConfig, AgentToolGroups } from '../registry.ts';

const REQUIRED_AGENT_TOOLS = ['progress_update', 'load_tools'] as const;
const MAX_PROMPT_BYTES = 256 * 1024;
const AGENT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

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

export function normalizeToolGroups(
	value: unknown,
): AgentToolGroups | undefined {
	if (!value || typeof value !== 'object') return undefined;
	if (Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const firstClass = normalizeStringList(record.firstClass);
	const loadable = normalizeStringList(record.loadable);
	return firstClass.length || loadable.length
		? { firstClass, loadable }
		: undefined;
}

export function withRequiredTools(tools: AgentToolConfig): AgentToolGroups {
	const groups = normalizeToolGroups(tools) ?? {};
	return {
		firstClass: Array.from(
			new Set([...(groups.firstClass ?? []), ...REQUIRED_AGENT_TOOLS]),
		),
		loadable: Array.from(new Set(groups.loadable ?? [])),
	};
}

export function validatePromptSize(prompt: string): void {
	if (new TextEncoder().encode(prompt).byteLength > MAX_PROMPT_BYTES) {
		throw new Error('Agent prompt is too large. Maximum size is 256 KB.');
	}
}
