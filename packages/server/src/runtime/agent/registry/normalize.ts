import {
	catalog,
	hasConfiguredProvider,
	type OttoConfig,
	type ProviderId,
	type ProviderName,
} from '@ottocode/sdk';
import { normalizeAgentDescription } from './descriptions.ts';
import { mergeToolGroups, normalizeAgentToolConfig } from './tools.ts';
import type { AgentConfigEntry } from './types.ts';

const providerValues = new Set<ProviderName>(
	Object.keys(catalog) as ProviderName[],
);

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Normalizes an agent provider default. Built-in ids are matched
 * case-insensitively; any other well-formed id is kept as a custom provider
 * candidate and must be validated with `resolveConfiguredAgentProvider`.
 */
export function normalizeProvider(value: unknown): ProviderId | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const lowered = trimmed.toLowerCase();
	if (providerValues.has(lowered as ProviderName)) return lowered;
	return PROVIDER_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function isBuiltInAgentProvider(provider: ProviderId): boolean {
	return providerValues.has(provider as ProviderName);
}

/** Keeps a provider default only when it is built in or configured. */
export function resolveConfiguredAgentProvider(
	provider: ProviderId | undefined,
	cfg: OttoConfig,
): ProviderId | undefined {
	if (!provider) return undefined;
	if (isBuiltInAgentProvider(provider)) return provider;
	return hasConfiguredProvider(cfg, provider) ? provider : undefined;
}

export function normalizeModel(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
}

export function mergeAgentEntries(
	base: AgentConfigEntry | undefined,
	override: AgentConfigEntry,
): AgentConfigEntry {
	const merged: AgentConfigEntry = {};
	const baseTools = normalizeAgentToolConfig(base?.tools);
	if (baseTools) merged.tools = baseTools;
	const baseAppend = normalizeAgentToolConfig(base?.appendTools);
	if (baseAppend) merged.appendTools = baseAppend;
	if (base && Object.hasOwn(base, 'prompt')) merged.prompt = base.prompt;
	if (base && Object.hasOwn(base, 'provider')) {
		merged.provider = normalizeProvider(base.provider);
	}
	if (base && Object.hasOwn(base, 'model')) {
		merged.model = normalizeModel(base.model);
	}
	if (base && Object.hasOwn(base, 'description')) {
		const normalized = normalizeAgentDescription(base.description);
		if (normalized) merged.description = normalized;
	}

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
	if (Object.hasOwn(override, 'description')) {
		const normalized = normalizeAgentDescription(override.description);
		if (normalized) merged.description = normalized;
		else delete merged.description;
	}
	return merged;
}
