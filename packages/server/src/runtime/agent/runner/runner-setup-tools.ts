import type { OttoConfig } from '@ottocode/sdk';
import type { DiscoveredTool } from '@ottocode/sdk';
import type { RunOpts } from '../../session/queue.ts';

const EDITING_TOOL_NAMES = [
	'edit',
	'multiedit',
	'write',
	'copy_into',
	'apply_patch',
];
const PREFERRED_EDITING_TOOLS = ['apply_patch', 'write', 'edit', 'multiedit'];
const MODEL_FAMILY_EDIT_TOOL_POLICY_AGENTS = new Set(['build']);

function normalizeToolName(toolName: string): string {
	return toolName === 'bash' ? 'shell' : toolName;
}

export function normalizeToolNames(toolNames: string[]): string[] {
	return Array.from(new Set(toolNames.map(normalizeToolName)));
}

export function mergeProviderOptions(
	base: Record<string, unknown>,
	incoming: Record<string, unknown>,
): Record<string, unknown> {
	for (const [key, value] of Object.entries(incoming)) {
		const existing = base[key];
		if (
			existing &&
			typeof existing === 'object' &&
			!Array.isArray(existing) &&
			value &&
			typeof value === 'object' &&
			!Array.isArray(value)
		) {
			base[key] = {
				...(existing as Record<string, unknown>),
				...(value as Record<string, unknown>),
			};
			continue;
		}

		base[key] = value;
	}

	return base;
}

/**
 * Normalizes the edit tool set for build agents. Every model family receives
 * the same editing tools; provider/model/config are accepted for API
 * compatibility only.
 */
export function applyModelFamilyEditToolPolicy(
	agent: string,
	tools: string[],
	_provider?: RunOpts['provider'],
	_model?: string,
	_cfg?: OttoConfig,
): string[] {
	const normalized = normalizeToolNames(tools);
	if (!MODEL_FAMILY_EDIT_TOOL_POLICY_AGENTS.has(agent)) return normalized;
	const next = normalized.filter(
		(toolName) => !EDITING_TOOL_NAMES.includes(toolName),
	);
	return Array.from(new Set([...next, ...PREFERRED_EDITING_TOOLS]));
}

export function buildAllowedTools(args: {
	agentName: string;
	agentTools: string[];
	provider: RunOpts['provider'];
	model: string;
	cfg: OttoConfig;
	allTools: DiscoveredTool[];
}): DiscoveredTool[] {
	const allowedNames = new Set(
		applyModelFamilyEditToolPolicy(args.agentName, args.agentTools),
	);
	return args.allTools.filter(
		(tool) =>
			allowedNames.has(tool.name) ||
			tool.name === 'load_tools' ||
			tool.name === 'load_mcp_tools',
	);
}
