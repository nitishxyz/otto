export { isProviderAuthorized, ensureProviderEnv } from './authorization.ts';
export { catalog } from './catalog-merged.ts';
export {
	DEFAULT_REMOTE_MODEL_CATALOG_URL,
	getCachedProviderCatalogEntry,
	getModelCatalogCachePath,
	mergeCachedModelCatalog,
	normalizeModelCatalogPayload,
	readCachedModelCatalog,
	readCachedModelCatalogSync,
	writeCachedModelCatalog,
} from './model-catalog-cache.ts';
export type {
	CachedModelCatalog,
	CachedProviderCatalogEntry,
} from './model-catalog-cache.ts';
export type {
	BuiltInProviderId,
	ProviderId,
	ProviderCompatibility,
	ProviderPromptFamily,
	ModelInfo,
	ModelProviderBinding,
	ProviderCatalogEntry,
} from '../../types/src/index.ts';
export {
	isProviderId,
	providerIds,
	defaultModelFor,
	hasModel,
	getFastModel,
	getFastModelForAuth,
	getModelNpmBinding,
	isAnthropicBasedModel,
	getUnderlyingProviderKey,
	getModelFamily,
	getModelInfo,
	modelSupportsReasoning,
} from './utils.ts';
export type { UnderlyingProviderKey } from './utils.ts';
export {
	discoverOllamaModels,
	normalizeOllamaBaseURL,
} from './ollama-discovery.ts';
export type {
	DiscoverOllamaOptions,
	DiscoverOllamaResult,
} from './ollama-discovery.ts';
export {
	isBuiltInProviderId,
	getProviderSettings,
	getProviderDefinition,
	hasConfiguredProvider,
	getConfiguredProviderIds,
	getConfiguredProviderModels,
	getConfiguredProviderDefaultModel,
	providerAllowsAnyModel,
	hasConfiguredModel,
	getConfiguredProviderFamily,
	getConfiguredProviderEnvVar,
	getConfiguredProviderApiKey,
} from './registry.ts';
export type { ResolvedProviderDefinition } from './registry.ts';
export { validateProviderModel } from './validate.ts';
export { estimateModelCostUsd } from './pricing.ts';
export { providerEnvVar, readEnvKey, setEnvKey } from './env.ts';
export {
	createOttoRouter,
	createOttoRouterFetch,
	createOttoRouterModel,
	fetchOttoRouterBalance,
	getPublicKeyFromPrivate,
	fetchSolanaUsdcBalance,
} from './ottorouter-client.ts';
export type {
	OttoRouterAuth,
	OttoRouterInstance,
	OttoRouterProviderOptions,
	OttoRouterPaymentCallbacks,
	OttoRouterBalanceUpdate,
	OttoRouterBalanceResponse,
	SolanaUsdcBalanceResponse,
} from './ottorouter-client.ts';
export {
	createOpenAIOAuthFetch,
	createOpenAIOAuthModel,
} from './openai-oauth-client.ts';
export type { OpenAIOAuthConfig } from './openai-oauth-client.ts';
export {
	isModelAllowedForOAuth,
	filterModelsForAuthType,
	getOAuthModelPrefixes,
} from './oauth-models.ts';
export {
	addAnthropicCacheControl,
	createAnthropicCachingFetch,
	createConditionalCachingFetch,
} from './anthropic-caching.ts';
export {
	createAnthropicOAuthFetch,
	createAnthropicOAuthModel,
} from './anthropic-oauth-client.ts';
export type { AnthropicOAuthConfig } from './anthropic-oauth-client.ts';
export { createGoogleModel } from './google-client.ts';
export type { GoogleProviderConfig } from './google-client.ts';
export { createXaiModel } from './xai-client.ts';
export type { XaiProviderConfig } from './xai-client.ts';
export { createZaiModel, createZaiCodingModel } from './zai-client.ts';
export type { ZaiProviderConfig } from './zai-client.ts';
export {
	getOpenRouterInstance,
	createOpenRouterModel,
} from './openrouter-client.ts';
export type { OpenRouterProviderConfig } from './openrouter-client.ts';
export { createOpencodeModel } from './opencode-client.ts';
export type { OpencodeProviderConfig } from './opencode-client.ts';
export { createMoonshotModel } from './moonshot-client.ts';
export type { MoonshotProviderConfig } from './moonshot-client.ts';
export { createMinimaxModel } from './minimax-client.ts';
export type { MinimaxProviderConfig } from './minimax-client.ts';
export { createCopilotFetch, createCopilotModel } from './copilot-client.ts';
export type { CopilotOAuthConfig } from './copilot-client.ts';
