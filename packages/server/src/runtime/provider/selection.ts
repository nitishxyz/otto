import type { OttoConfig } from '@ottocode/sdk';
import {
	type ProviderId,
	isProviderAuthorized,
	getConfiguredProviderIds,
	getConfiguredProviderDefaultModel,
	hasConfiguredModel,
	hasConfiguredProvider,
} from '@ottocode/sdk';

const FALLBACK_ORDER: ProviderId[] = [
	'anthropic',
	'openai',
	'google',
	'opencode',
	'openrouter',
	'ottorouter',
];

type SelectionInput = {
	cfg: OttoConfig;
	agentProviderDefault: ProviderId;
	agentModelDefault: string;
	explicitProvider?: ProviderId;
	explicitModel?: string;
	allowUnknownModel?: boolean;
	skipAuth?: boolean;
};

export type ProviderSelection = {
	provider: ProviderId;
	model: string;
	providerOverride?: ProviderId;
	modelOverride?: string;
};

export async function selectProviderAndModel(
	input: SelectionInput,
): Promise<ProviderSelection> {
	const {
		cfg,
		agentProviderDefault,
		agentModelDefault,
		explicitProvider,
		explicitModel,
		allowUnknownModel,
		skipAuth,
	} = input;

	const provider = skipAuth
		? (explicitProvider ?? agentProviderDefault)
		: await pickAuthorizedProvider({
				cfg,
				candidate: explicitProvider ?? agentProviderDefault,
			});

	if (!provider) {
		throw new Error(
			'No authorized providers found. Run `otto auth login` to configure at least one provider.',
		);
	}

	const model = resolveModelForProvider({
		cfg,
		provider,
		explicitModel,
		allowUnknownModel,
		agentModelDefault,
	});

	const providerOverride =
		explicitProvider ??
		(provider !== agentProviderDefault ? provider : undefined);
	const modelOverride =
		explicitModel ?? (model !== agentModelDefault ? model : undefined);

	return { provider, model, providerOverride, modelOverride };
}

async function pickAuthorizedProvider(args: {
	cfg: OttoConfig;
	candidate: ProviderId;
}): Promise<ProviderId | undefined> {
	const { cfg, candidate } = args;
	const candidates = uniqueProviders([
		candidate,
		...FALLBACK_ORDER,
		...getConfiguredProviderIds(cfg),
	]);
	for (const provider of candidates) {
		if (!hasConfiguredProvider(cfg, provider)) continue;
		const ok = await isProviderAuthorized(cfg, provider);
		if (ok) return provider;
	}
	return undefined;
}

function uniqueProviders(list: ProviderId[]): ProviderId[] {
	const seen = new Set<ProviderId>();
	const ordered: ProviderId[] = [];
	for (const provider of list) {
		if (seen.has(provider)) continue;
		seen.add(provider);
		ordered.push(provider);
	}
	return ordered;
}

function resolveModelForProvider(args: {
	cfg: OttoConfig;
	provider: ProviderId;
	explicitModel?: string;
	allowUnknownModel?: boolean;
	agentModelDefault: string;
}): string {
	const { cfg, provider, explicitModel, allowUnknownModel, agentModelDefault } =
		args;
	if (explicitModel && hasConfiguredModel(cfg, provider, explicitModel)) {
		return explicitModel;
	}
	if (explicitModel && allowUnknownModel && explicitModel.trim()) {
		return explicitModel;
	}
	if (hasConfiguredModel(cfg, provider, agentModelDefault)) {
		return agentModelDefault;
	}
	return getConfiguredProviderDefaultModel(cfg, provider) ?? agentModelDefault;
}
