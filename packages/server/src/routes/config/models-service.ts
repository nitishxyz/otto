import {
	DEFAULT_REMOTE_MODEL_CATALOG_URL,
	catalog,
	discoverOllamaModels,
	filterModelsForAuthType,
	getAuth,
	getProviderDefinition,
	loadConfig,
	logger,
	mergeCachedModelCatalog,
	normalizeModelCatalogPayload,
	providerAllowsAnyModel,
	readCachedModelCatalog,
	readEnvKey,
	type ModelInfo,
	type ProviderId,
} from '@ottocode/sdk';
import type { Context } from 'hono';
import type { EmbeddedAppConfig } from '../../index.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	getAuthTypeForProvider,
	getAuthorizedProviders,
	getDefault,
	isProviderAuthorizedHybrid,
} from './utils.ts';

const COPILOT_MODELS_URL = 'https://api.githubcopilot.com/models';
const REMOTE_CATALOG_REFRESH_TTL_MS = 5 * 60 * 1000;
const PROVIDER_MODEL_REFRESH_TTL_MS = 60 * 1000;
const USE_BUILTIN_MODEL_CATALOG = process.env.CI === 'true';

type UiModel = {
	id: string;
	label: string;
	toolCall?: boolean;
	reasoningText?: boolean;
	vision?: boolean;
	attachment?: boolean;
	free?: boolean;
	contextWindow?: number;
	maxOutputTokens?: number;
};

type UiProviderModels = {
	label: string;
	authType?: 'api' | 'oauth' | 'wallet';
	allowAnyModel?: boolean;
	dynamicModels?: boolean;
	models: UiModel[];
};

const remoteCatalogRefreshes = new Set<string>();
const providerModelRefreshes = new Set<string>();
const providerModelRefreshAt = new Map<string, number>();
let remoteCatalogRefreshAt = 0;

function getEmbeddedConfig(c: Context): EmbeddedAppConfig | undefined {
	return (
		c as unknown as {
			get: (key: 'embeddedConfig') => EmbeddedAppConfig | undefined;
		}
	).get('embeddedConfig');
}

function toUiModel(model: ModelInfo): UiModel {
	return {
		id: model.id,
		label: model.label || model.id,
		toolCall: model.toolCall,
		reasoningText: model.reasoningText,
		vision: model.modalities?.input?.includes('image') ?? false,
		attachment: model.attachment ?? false,
		free: model.cost?.input === 0 && model.cost?.output === 0,
		contextWindow: model.limit?.context,
		maxOutputTokens: model.limit?.output,
	};
}

function getRemoteCatalogUrl(): string {
	return (
		process.env.OTTO_MODEL_CATALOG_URL?.trim() ||
		DEFAULT_REMOTE_MODEL_CATALOG_URL
	);
}

function getModelCatalogProviders(
	cachedCatalog: Awaited<ReturnType<typeof readCachedModelCatalog>>,
): Record<string, { models?: ModelInfo[]; label?: string }> {
	return cachedCatalog?.providers ?? (USE_BUILTIN_MODEL_CATALOG ? catalog : {});
}

async function refreshRemoteCatalogInBackground(): Promise<void> {
	const url = getRemoteCatalogUrl();
	const now = Date.now();
	if (now - remoteCatalogRefreshAt < REMOTE_CATALOG_REFRESH_TTL_MS) return;
	const cachedCatalog = await readCachedModelCatalog();
	const cachedAt = cachedCatalog ? Date.parse(cachedCatalog.updatedAt) : 0;
	if (Number.isFinite(cachedAt)) {
		remoteCatalogRefreshAt = Math.max(remoteCatalogRefreshAt, cachedAt);
		if (now - remoteCatalogRefreshAt < REMOTE_CATALOG_REFRESH_TTL_MS) return;
	}
	if (remoteCatalogRefreshes.has(url)) return;
	remoteCatalogRefreshes.add(url);
	remoteCatalogRefreshAt = now;
	try {
		const response = await fetch(url);
		if (!response.ok)
			throw new Error(`${response.status} ${response.statusText}`);
		const providers = normalizeModelCatalogPayload(await response.json());
		if (Object.keys(providers).length > 0) {
			await mergeCachedModelCatalog(providers);
			logger.debug('Refreshed remote model catalog', {
				url,
				providers: Object.keys(providers).length,
			});
		}
	} catch (error) {
		logger.debug('Failed to refresh remote model catalog', {
			url,
			error: error instanceof Error ? error.message : String(error),
		});
	} finally {
		remoteCatalogRefreshes.delete(url);
	}
}

async function discoverProviderModels(args: {
	provider: ProviderId;
	providerDefinition: NonNullable<ReturnType<typeof getProviderDefinition>>;
	projectRoot: string;
}): Promise<ModelInfo[] | undefined> {
	const { provider, providerDefinition, projectRoot } = args;
	if (
		providerDefinition.source !== 'custom' ||
		providerDefinition.compatibility !== 'ollama' ||
		!providerDefinition.baseURL
	) {
		return undefined;
	}

	try {
		const auth = await getAuth(provider, projectRoot);
		const apiKey =
			auth?.type === 'api'
				? auth.key
				: (readEnvKey(provider) ?? providerDefinition.apiKey);
		const discovered = await discoverOllamaModels({
			baseURL: providerDefinition.baseURL,
			apiKey,
			includeDetails: true,
		});
		return discovered.models;
	} catch (error) {
		logger.warn('Failed to discover Ollama models', {
			provider,
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

async function refreshProviderModelsInBackground(args: {
	provider: ProviderId;
	providerDefinition: NonNullable<ReturnType<typeof getProviderDefinition>>;
	projectRoot: string;
}): Promise<void> {
	const refreshKey = `${args.projectRoot}:${args.provider}`;
	const now = Date.now();
	const lastRefresh = providerModelRefreshAt.get(refreshKey) ?? 0;
	if (now - lastRefresh < PROVIDER_MODEL_REFRESH_TTL_MS) return;
	if (providerModelRefreshes.has(refreshKey)) return;
	providerModelRefreshes.add(refreshKey);
	providerModelRefreshAt.set(refreshKey, now);
	try {
		const { provider, providerDefinition, projectRoot } = args;
		const discoveredModels = await discoverProviderModels({
			provider,
			providerDefinition,
			projectRoot,
		});
		if (!discoveredModels) return;
		await mergeCachedModelCatalog({
			[provider]: {
				id: provider,
				label: providerDefinition.label,
				models: discoveredModels,
			},
		});
	} catch (error) {
		logger.debug('Failed to refresh provider model cache', {
			provider: args.provider,
			error: error instanceof Error ? error.message : String(error),
		});
	} finally {
		providerModelRefreshes.delete(refreshKey);
	}
}

function shouldLazyLoadProviderModels(
	providerDefinition: NonNullable<ReturnType<typeof getProviderDefinition>>,
): boolean {
	return (
		providerDefinition.source === 'custom' &&
		providerDefinition.compatibility === 'ollama'
	);
}

function getProviderModelsForUi(args: {
	catalogModels: ModelInfo[] | undefined;
	provider: ProviderId;
	authType: 'api' | 'oauth' | 'wallet' | undefined;
}): ModelInfo[] {
	const catalogModels = args.catalogModels ?? [];
	return filterModelsForAuthType(args.provider, catalogModels, args.authType);
}

function getUiProviderLabel(
	providerDefinition: NonNullable<ReturnType<typeof getProviderDefinition>>,
): string {
	if (providerDefinition.source !== 'custom') return providerDefinition.label;
	return providerDefinition.label.includes('(custom)')
		? providerDefinition.label
		: `${providerDefinition.label} (custom)`;
}

function filterCopilotAvailability<T extends { id: string }>(
	provider: ProviderId,
	models: T[],
	copilotAllowedModels: Set<string> | null,
): T[] {
	if (provider !== 'copilot') return models;
	if (!copilotAllowedModels || copilotAllowedModels.size === 0) return models;
	return models.filter((m) => copilotAllowedModels.has(m.id));
}

async function getCopilotAuthTokens(projectRoot: string): Promise<string[]> {
	const tokens: string[] = [];
	const envToken = readEnvKey('copilot');
	if (envToken) tokens.push(envToken);
	const auth = await getAuth('copilot', projectRoot);
	if (auth?.type === 'oauth' && auth.refresh && auth.refresh !== envToken) {
		tokens.push(auth.refresh);
	}
	return tokens;
}

async function getAuthorizedCopilotModels(
	projectRoot: string,
): Promise<Set<string> | null> {
	const tokens = await getCopilotAuthTokens(projectRoot);
	if (!tokens.length) return null;
	const merged = new Set<string>();
	let successful = false;

	for (const token of tokens) {
		try {
			const response = await fetch(COPILOT_MODELS_URL, {
				headers: {
					Authorization: `Bearer ${token}`,
					'Openai-Intent': 'conversation-edits',
					'User-Agent': 'ottocode',
				},
			});
			if (!response.ok) continue;
			successful = true;
			const payload = (await response.json()) as {
				data?: Array<{ id?: string }>;
			};
			for (const id of (payload.data ?? []).map((item) => item.id)) {
				if (id) merged.add(id);
			}
		} catch {}
	}

	return successful ? merged : null;
}

export async function handleGetProviderModels(c: Context) {
	try {
		const embeddedConfig = getEmbeddedConfig(c);
		const provider = c.req.param('provider') as ProviderId;
		const projectRoot = c.req.query('project') || process.cwd();
		const cfg = await loadConfig(projectRoot);
		const cachedCatalog = await readCachedModelCatalog();
		const modelCatalogProviders = getModelCatalogProviders(cachedCatalog);
		const providerCatalog = modelCatalogProviders[provider];

		const authorized = await isProviderAuthorizedHybrid(
			embeddedConfig,
			cfg,
			provider,
		);
		if (!authorized) {
			logger.warn('Provider not authorized', { provider });
			return c.json({ error: 'Provider not authorized' }, 403);
		}

		const providerDefinition = getProviderDefinition(cfg, provider);
		if (!providerDefinition && !providerCatalog) {
			logger.warn('Provider not found in catalog', { provider });
			return c.json({ error: 'Provider not found' }, 404);
		}
		void refreshRemoteCatalogInBackground();

		const authType = await getAuthTypeForProvider(
			embeddedConfig,
			provider,
			projectRoot,
		);
		if (
			providerDefinition &&
			shouldLazyLoadProviderModels(providerDefinition)
		) {
			void refreshProviderModelsInBackground({
				provider,
				providerDefinition,
				projectRoot,
			});
		}
		const filteredModels = getProviderModelsForUi({
			catalogModels: providerCatalog?.models ?? providerDefinition?.models,
			provider,
			authType,
		});
		const copilotAllowedModels =
			provider === 'copilot'
				? await getAuthorizedCopilotModels(projectRoot)
				: null;
		const availableModels = filterCopilotAvailability(
			provider,
			filteredModels,
			copilotAllowedModels,
		);

		return c.json({
			models: availableModels.map(toUiModel),
			default: getDefault(
				embeddedConfig?.model,
				embeddedConfig?.defaults?.model,
				cfg.defaults.model,
			),
			allowAnyModel: providerDefinition
				? providerAllowsAnyModel(cfg, provider)
				: undefined,
			label: providerDefinition
				? getUiProviderLabel(providerDefinition)
				: (providerCatalog?.label ?? provider),
		});
	} catch (error) {
		logger.error('Failed to get provider models', error);
		const errorResponse = serializeError(error);
		return c.json(errorResponse, errorResponse.error.status || 500);
	}
}

export async function handleGetAllModels(c: Context) {
	try {
		const embeddedConfig = getEmbeddedConfig(c);
		const projectRoot = c.req.query('project') || process.cwd();
		const cfg = await loadConfig(projectRoot);
		const authorizedProviders = await getAuthorizedProviders(
			embeddedConfig,
			cfg,
		);
		const cachedCatalog = await readCachedModelCatalog();
		const modelCatalogProviders = getModelCatalogProviders(cachedCatalog);
		void refreshRemoteCatalogInBackground();

		const modelsMap: Record<string, UiProviderModels> = {};
		for (const provider of authorizedProviders) {
			const providerCatalog = modelCatalogProviders[provider];
			const providerDefinition = getProviderDefinition(cfg, provider);
			if (!providerCatalog && !providerDefinition) continue;
			const dynamicModels =
				providerDefinition && shouldLazyLoadProviderModels(providerDefinition);
			const authType = await getAuthTypeForProvider(
				embeddedConfig,
				provider,
				projectRoot,
			);
			if (dynamicModels && providerDefinition) {
				void refreshProviderModelsInBackground({
					provider,
					providerDefinition,
					projectRoot,
				});
			}
			const filteredModels = getProviderModelsForUi({
				catalogModels: providerCatalog?.models ?? providerDefinition?.models,
				provider,
				authType,
			});
			modelsMap[provider] = {
				label: providerDefinition
					? getUiProviderLabel(providerDefinition)
					: (providerCatalog?.label ?? provider),
				authType,
				allowAnyModel: providerDefinition?.allowAnyModel,
				dynamicModels,
				models: filteredModels.map(toUiModel),
			};
		}

		return c.json(modelsMap);
	} catch (error) {
		logger.error('Failed to get all models', error);
		const errorResponse = serializeError(error);
		return c.json(errorResponse, errorResponse.error.status || 500);
	}
}
