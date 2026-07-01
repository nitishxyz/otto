import {
	discoverOllamaModels,
	isBuiltInProviderId,
	loadConfig,
	logger,
	mapConfiguredModelEntries,
	removeProviderSettings,
	writeProviderSettings,
	type ModelInfo,
	type ModelInfoMap,
	type ProviderCompatibility,
	type ProviderId,
	type ProviderPromptFamily,
	type ProviderSettingsEntry,
} from '@ottocode/sdk';
import type { Context } from 'hono';
import type { EmbeddedAppConfig } from '../../index.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import {
	getAuthorizedProviders,
	getDefault,
	getProviderDetails,
} from './utils.ts';

type ProviderMutationBody = {
	enabled?: boolean;
	custom?: boolean;
	label?: string;
	compatibility?: ProviderCompatibility;
	family?: ProviderPromptFamily;
	baseURL?: string | null;
	apiKey?: string | null;
	apiKeyEnv?: string | null;
	models?: ModelInfoMap;
	allowAnyModel?: boolean;
};

type ProviderDiscoveryBody = {
	compatibility?: ProviderCompatibility;
	baseURL?: string;
	apiKey?: string;
};

function getEmbeddedConfig(c: Context): EmbeddedAppConfig | undefined {
	return (
		c as unknown as {
			get: (key: 'embeddedConfig') => EmbeddedAppConfig | undefined;
		}
	).get('embeddedConfig');
}

function isEmbeddedConfigActive(
	config: EmbeddedAppConfig | undefined,
): boolean {
	return Boolean(config && Object.keys(config).length > 0);
}

function toDiscoveredModel(model: ModelInfo) {
	return {
		id: model.id,
		label: model.label || model.id,
		toolCall: model.toolCall,
		reasoningText: model.reasoningText,
		vision: model.modalities?.input?.includes('image') ?? false,
		attachment: model.attachment ?? false,
		contextWindow: model.limit?.context,
		maxOutputTokens: model.limit?.output,
	};
}

export async function handleGetProviders(c: Context) {
	try {
		const embeddedConfig = getEmbeddedConfig(c);

		if (isEmbeddedConfigActive(embeddedConfig)) {
			const providers = embeddedConfig?.auth
				? (Object.keys(embeddedConfig.auth) as ProviderId[])
				: embeddedConfig?.provider
					? [embeddedConfig.provider]
					: [];

			return c.json({
				providers,
				details: providers.map((provider) => ({
					id: provider,
					label: provider,
					source: 'built-in',
					enabled: true,
					authorized: true,
					custom: false,
					hasApiKey: false,
					allowAnyModel: false,
					modelCount: 0,
				})),
				default: getDefault(
					embeddedConfig?.provider,
					embeddedConfig?.defaults?.provider,
					undefined,
				),
			});
		}

		const projectRoot = await resolveRequestProjectRoot(c);
		const cfg = await loadConfig(projectRoot);
		const authorizedProviders = await getAuthorizedProviders(undefined, cfg);
		const details = await getProviderDetails(undefined, cfg);

		return c.json({
			providers: authorizedProviders,
			details,
			default: cfg.defaults.provider,
		});
	} catch (error) {
		logger.error('Failed to get providers', error);
		const errorResponse = serializeError(error);
		return c.json(errorResponse, errorResponse.error.status || 500);
	}
}

export async function handleDiscoverProviderModels(c: Context) {
	try {
		if (isEmbeddedConfigActive(getEmbeddedConfig(c))) {
			return c.json({ error: 'Embedded config cannot be modified' }, 400);
		}

		const body = await c.req.json<ProviderDiscoveryBody>();
		const compatibility = body.compatibility || 'openai-compatible';
		const baseURL = body.baseURL?.trim();
		const apiKey = body.apiKey?.trim() || undefined;
		if (!baseURL) return c.json({ error: 'Base URL is required' }, 400);

		if (compatibility !== 'ollama') {
			return c.json({
				models: [],
				unsupported: true,
				message: 'Model discovery is currently available for Ollama providers.',
			});
		}

		const discovered = await discoverOllamaModels({
			baseURL,
			apiKey,
			includeDetails: true,
		});

		return c.json({
			baseURL: discovered.baseURL,
			models: discovered.models.map(toDiscoveredModel),
		});
	} catch (error) {
		logger.error('Failed to discover provider models', error);
		const errorResponse = serializeError(error);
		return c.json(errorResponse, errorResponse.error.status || 500);
	}
}

function buildProviderUpdates(
	provider: string,
	body: ProviderMutationBody,
): ProviderSettingsEntry {
	const updates: ProviderSettingsEntry = {
		enabled: body.enabled ?? true,
		custom: isBuiltInProviderId(provider) ? body.custom : (body.custom ?? true),
	};

	if (body.label !== undefined) updates.label = body.label.trim() || undefined;
	if (body.compatibility !== undefined)
		updates.compatibility = body.compatibility;
	if (body.family !== undefined) updates.family = body.family;
	if (body.baseURL !== undefined) {
		updates.baseURL = body.baseURL?.trim() || undefined;
	}
	if (body.apiKey !== undefined) {
		updates.apiKey = body.apiKey?.trim() || undefined;
	}
	if (body.apiKeyEnv !== undefined) {
		updates.apiKeyEnv = body.apiKeyEnv?.trim() || undefined;
	}
	if (body.models !== undefined) {
		updates.models = mapConfiguredModelEntries(body.models);
	}
	if (body.allowAnyModel !== undefined) {
		updates.allowAnyModel = body.allowAnyModel;
	}

	return updates;
}

export async function handleUpdateProviderSettings(c: Context) {
	try {
		if (isEmbeddedConfigActive(getEmbeddedConfig(c))) {
			return c.json({ error: 'Embedded config cannot be modified' }, 400);
		}

		const projectRoot = await resolveRequestProjectRoot(c);
		const provider = c.req.param('provider').trim();
		const body = await c.req.json<ProviderMutationBody>();
		if (!provider) return c.json({ error: 'Provider is required' }, 400);

		const updates = buildProviderUpdates(provider, body);
		if (!isBuiltInProviderId(provider) && !updates.compatibility) {
			return c.json({ error: 'Custom providers require compatibility' }, 400);
		}

		await writeProviderSettings('global', provider, updates, projectRoot);
		const cfg = await loadConfig(projectRoot);
		const details = await getProviderDetails(undefined, cfg);
		return c.json({
			success: true,
			provider,
			details,
		});
	} catch (error) {
		logger.error('Failed to update provider settings', error);
		const errorResponse = serializeError(error);
		return c.json(errorResponse, errorResponse.error.status || 500);
	}
}

export async function handleDeleteProviderSettings(c: Context) {
	try {
		if (isEmbeddedConfigActive(getEmbeddedConfig(c))) {
			return c.json({ error: 'Embedded config cannot be modified' }, 400);
		}

		const projectRoot = await resolveRequestProjectRoot(c);
		const provider = c.req.param('provider').trim();
		if (!provider) return c.json({ error: 'Provider is required' }, 400);

		await removeProviderSettings('global', provider, projectRoot);
		const cfg = await loadConfig(projectRoot);
		const details = await getProviderDetails(undefined, cfg);
		return c.json({ success: true, provider, details });
	} catch (error) {
		logger.error('Failed to remove provider settings', error);
		const errorResponse = serializeError(error);
		return c.json(errorResponse, errorResponse.error.status || 500);
	}
}
