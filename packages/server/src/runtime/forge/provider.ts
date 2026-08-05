import {
	getConfiguredProviderIds,
	getGlobalConfigPath,
	getProviderDefinition,
	getProviderSettings,
	isProviderAuthorized,
	loadConfig,
	modelListToMap,
	modelMapToList,
	removeProviderSettings,
	writeProviderSettings,
	type ProviderSettingsEntry,
} from '@ottocode/sdk';
import type { ForgeInput, ForgeMutation, ForgePlan } from './types.ts';

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function providerName(input: ForgeInput): string {
	const name = input.name?.trim().toLowerCase();
	if (!name) throw new Error('name is required for provider actions');
	if (!PROVIDER_ID_PATTERN.test(name)) {
		throw new Error(
			'Invalid provider name. Use lowercase letters, numbers, and hyphens.',
		);
	}
	return name;
}

function providerMutation(
	input: ForgeInput,
): ForgeMutation | 'enable' | 'disable' {
	if (input.action === 'plan') {
		if (!input.targetAction)
			throw new Error('targetAction is required for plan');
		return input.targetAction;
	}
	if (
		input.action === 'create' ||
		input.action === 'update' ||
		input.action === 'remove' ||
		input.action === 'enable' ||
		input.action === 'disable'
	) {
		return input.action;
	}
	throw new Error(`Action '${input.action}' is not supported for provider`);
}

function buildProviderUpdates(
	input: ForgeInput,
	action: ForgeMutation | 'enable' | 'disable',
	source: 'built-in' | 'custom' | undefined,
	existingEnabled: boolean | undefined,
): ProviderSettingsEntry {
	const custom = source !== 'built-in';
	if (action === 'create' && !input.compatibility) {
		throw new Error('compatibility is required to create a custom provider');
	}
	if (action === 'create' && !input.baseURL?.trim()) {
		throw new Error('baseURL is required to create a custom provider');
	}

	return {
		enabled:
			action === 'disable'
				? false
				: action === 'enable'
					? true
					: existingEnabled !== false,
		...(custom ? { custom: true } : {}),
		...(input.label?.trim() || input.description?.trim()
			? { label: input.label?.trim() || input.description?.trim() }
			: {}),
		...(input.compatibility ? { compatibility: input.compatibility } : {}),
		...(input.family ? { family: input.family } : {}),
		...(input.baseURL?.trim() ? { baseURL: input.baseURL.trim() } : {}),
		...(input.apiKeyEnv?.trim() ? { apiKeyEnv: input.apiKeyEnv.trim() } : {}),
		...(input.models
			? {
					models: modelListToMap(
						input.models
							.map((id) => id.trim())
							.filter(Boolean)
							.map((id) => ({ id, label: id })),
					),
				}
			: {}),
		...(input.fastModels
			? { fastModels: input.fastModels.map((id) => id.trim()).filter(Boolean) }
			: {}),
		...(input.allowAnyModel !== undefined
			? { allowAnyModel: input.allowAnyModel }
			: {}),
		...(input.modelDiscovery !== undefined
			? {
					modelDiscovery:
						input.modelDiscovery === 'none'
							? undefined
							: { type: input.modelDiscovery },
				}
			: {}),
	};
}

async function summarizeProvider(projectRoot: string, name: string) {
	const config = await loadConfig(projectRoot);
	const definition = getProviderDefinition(config, name);
	if (!definition) return undefined;
	const settings = getProviderSettings(config, name);
	return {
		name,
		label: definition.label,
		source: definition.source,
		enabled: settings?.enabled !== false,
		configured: Boolean(settings),
		authorized: await isProviderAuthorized(config, name),
		compatibility: definition.compatibility,
		family: definition.family,
		baseURL: definition.baseURL,
		apiKeyEnv: definition.apiKeyEnv,
		models: modelMapToList(definition.models).map((model) => model.id),
		allowAnyModel: definition.allowAnyModel,
		fastModels: settings?.fastModels ?? [],
		modelDiscovery: settings?.modelDiscovery?.type,
	};
}

export async function listForgeProviders(projectRoot: string) {
	const config = await loadConfig(projectRoot);
	return Promise.all(
		getConfiguredProviderIds(config, { includeDisabled: true }).map((name) =>
			summarizeProvider(projectRoot, name),
		),
	).then((providers) => providers.filter((provider) => provider !== undefined));
}

export async function runForgeProviderAction(
	projectRoot: string,
	input: ForgeInput,
) {
	if (input.action === 'status') {
		const provider = await summarizeProvider(projectRoot, providerName(input));
		if (!provider) throw new Error(`Provider '${input.name}' not found`);
		return { ok: true, provider };
	}

	const name = providerName(input);
	const action = providerMutation(input);
	const config = await loadConfig(projectRoot);
	const definition = getProviderDefinition(config, name);
	const settings = getProviderSettings(config, name);

	if (action === 'create' && definition) {
		throw new Error(`Provider '${name}' already exists; use update`);
	}
	if (
		(action === 'update' || action === 'enable' || action === 'disable') &&
		!definition
	) {
		throw new Error(`Provider '${name}' not found`);
	}
	if (action === 'remove' && !settings) {
		throw new Error(`Provider '${name}' has no configured override to remove`);
	}

	const updates =
		action === 'remove'
			? undefined
			: buildProviderUpdates(
					input,
					action,
					definition?.source,
					settings?.enabled,
				);
	const plan: ForgePlan = {
		action: action === 'enable' || action === 'disable' ? 'update' : action,
		target: {
			kind: 'provider',
			scope: 'global',
			name,
			paths: [getGlobalConfigPath()],
		},
		exists: Boolean(definition),
		changes: [
			action === 'remove'
				? `Remove provider override '${name}'`
				: `${action} provider '${name}'`,
		],
		...(updates ? { preview: JSON.stringify(updates, null, 2) } : {}),
	};

	if (input.action === 'plan' || input.dryRun) {
		return { ok: true, applied: false, plan };
	}
	if (action === 'remove') {
		await removeProviderSettings('global', name, projectRoot);
	} else {
		await writeProviderSettings(
			'global',
			name,
			updates as ProviderSettingsEntry,
			projectRoot,
		);
	}
	return {
		ok: true,
		applied: true,
		plan,
		provider: await summarizeProvider(projectRoot, name),
	};
}
