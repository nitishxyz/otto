import {
	getConfiguredProviderFamily,
	getModelFamily,
	type OttoConfig,
} from '@ottocode/sdk';
import type { DiscoveredTool } from '@ottocode/sdk';
import type { RunOpts } from '../session/queue.ts';

const EDITING_TOOL_NAMES = [
	'edit',
	'multiedit',
	'write',
	'copy_into',
	'apply_patch',
];
const MODEL_FAMILY_EDIT_TOOL_POLICY_AGENTS = new Set([
	'build',
	'general',
	'init',
]);

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

export function applyModelFamilyEditToolPolicy(
	agent: string,
	tools: string[],
	provider: RunOpts['provider'],
	model: string,
	cfg?: OttoConfig,
): string[] {
	tools = normalizeToolNames(tools);
	if (!MODEL_FAMILY_EDIT_TOOL_POLICY_AGENTS.has(agent)) return tools;

	const family = cfg
		? getConfiguredProviderFamily(cfg, provider, model)
		: getModelFamily(provider, model);
	const next = tools.filter(
		(toolName) => !EDITING_TOOL_NAMES.includes(toolName),
	);
	const preferredEditingTools =
		family === 'anthropic' || family === 'openai'
			? ['write', 'copy_into', 'apply_patch']
			: ['write', 'edit', 'multiedit', 'copy_into'];

	return Array.from(new Set([...next, ...preferredEditingTools]));
}

export function buildAllowedTools(args: {
	agentName: string;
	agentTools: string[];
	provider: RunOpts['provider'];
	model: string;
	cfg: OttoConfig;
	allTools: DiscoveredTool[];
}): DiscoveredTool[] {
	const allowedToolNames = applyModelFamilyEditToolPolicy(
		args.agentName,
		args.agentTools,
		args.provider,
		args.model,
		args.cfg,
	);
	const allowedNames = new Set([
		...normalizeToolNames(allowedToolNames),
		'finish',
	]);
	return args.allTools.filter(
		(tool) =>
			allowedNames.has(tool.name) ||
			tool.name === 'load_mcp_tools' ||
			tool.name === 'load_builtin_toolset',
	);
}
