import { getConfiguredProviderModels, type OttoConfig } from '@ottocode/sdk';
import type { DiscoveredTool, ModelInfo } from '@ottocode/sdk';
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

const LOWER_TIER_MODEL_PATTERNS = [
	/(^|[-_/])fast($|[-_/])/,
	/(^|[-_/])flash($|[-_/])/,
	/(^|[-_/])mini($|[-_/])/,
	/(^|[-_/])nano($|[-_/])/,
	/(^|[-_/])lite($|[-_/])/,
	/(^|[-_/])small($|[-_/])/,
	/(^|[-_/])haiku($|[-_/])/,
	/(^|[-_/])composer($|[-_/])/,
] as const;

const STRUCTURED_EDIT_COST_LIMIT = { input: 1, output: 5 } as const;

function findConfiguredModelInfo(
	cfg: OttoConfig | undefined,
	provider: RunOpts['provider'],
	model: string,
): ModelInfo | undefined {
	if (!cfg) return undefined;
	return getConfiguredProviderModels(cfg, provider).find(
		(entry) => entry.id === model,
	);
}

function isLowCostModel(modelInfo: ModelInfo | undefined): boolean {
	const cost = modelInfo?.cost;
	if (!cost) return false;
	return (
		cost.input !== undefined &&
		cost.output !== undefined &&
		cost.input <= STRUCTURED_EDIT_COST_LIMIT.input &&
		cost.output <= STRUCTURED_EDIT_COST_LIMIT.output
	);
}

function shouldUseStructuredEditTools(
	model: string,
	modelInfo: ModelInfo | undefined,
): boolean {
	if (modelInfo?.editToolCapability === 'structured') return true;
	if (modelInfo?.editToolCapability === 'patch') return false;
	if (isLowCostModel(modelInfo)) return true;

	const normalizedModel = model.toLowerCase();
	return LOWER_TIER_MODEL_PATTERNS.some((pattern) =>
		pattern.test(normalizedModel),
	);
}

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

	const modelInfo = findConfiguredModelInfo(cfg, provider, model);
	const next = tools.filter(
		(toolName) => !EDITING_TOOL_NAMES.includes(toolName),
	);
	if (shouldUseStructuredEditTools(model, modelInfo)) {
		return Array.from(
			new Set([
				...next,
				'apply_patch',
				'write',
				'edit',
				'multiedit',
				'copy_into',
			]),
		);
	}

	const preferredEditingTools = [
		'apply_patch',
		'write',
		'edit',
		'multiedit',
		'copy_into',
	];

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
	const allowedNames = new Set(normalizeToolNames(allowedToolNames));
	return args.allTools.filter(
		(tool) =>
			allowedNames.has(tool.name) ||
			tool.name === 'load_tools' ||
			tool.name === 'load_mcp_tools',
	);
}
