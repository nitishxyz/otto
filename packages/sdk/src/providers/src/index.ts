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
	ModelAuthType,
	ModelInfo,
	ModelInfoMap,
	ModelProviderBinding,
	ProviderCatalogEntry,
} from '../../types/src/index.ts';
export {
	getModelFromMap,
	hasModelInMap,
	mapConfiguredModelEntries,
	modelListToMap,
	modelMapToList,
} from './model-map.ts';
export { mergeModelMaps } from './model-merge.ts';
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
export {
	resolveOpenAIResponsesModel,
	shouldUseOpenAIResponsesApi,
} from './model-resolution.ts';
export type {
	DiscoverOllamaOptions,
	DiscoverOllamaResult,
} from './ollama-discovery.ts';
export {
	isBuiltInProviderId,
	resolveBuiltInProviderCatalogId,
	getProviderSettings,
	getProviderDefinition,
	hasConfiguredProvider,
	getConfiguredProviderIds,
	getConfiguredProviderModels,
	getConfiguredProviderDefaultModel,
	getConfiguredFastModelForAuth,
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
export { createPromptCacheKeyFetch } from './prompt-caching.ts';
export {
	createAnthropicOAuthFetch,
	createAnthropicOAuthModel,
} from './anthropic-oauth-client.ts';
export type { AnthropicOAuthConfig } from './anthropic-oauth-client.ts';
export { createGoogleModel } from './google-client.ts';
export type { GoogleProviderConfig } from './google-client.ts';
export {
	createXaiModel,
	getGrokCliHeaders,
	isXaiGrokCliModel,
	normalizeXaiResponsesImagePayload,
	XAI_GROK_CLI_MODEL_IDS,
} from './xai-client.ts';
export type { XaiProviderConfig } from './xai-client.ts';
export { createZaiModel, createZaiCodingModel } from './zai-client.ts';
export type { ZaiProviderConfig } from './zai-client.ts';
export { createDeepSeekModel } from './deepseek-client.ts';
export type { DeepSeekProviderConfig } from './deepseek-client.ts';
export { createBasetenModel } from './baseten-client.ts';
export type { BasetenProviderConfig } from './baseten-client.ts';
export { createHuggingFaceModel } from './huggingface-client.ts';
export type { HuggingFaceProviderConfig } from './huggingface-client.ts';
export { createWaferModel } from './wafer-client.ts';
export type { WaferProviderConfig } from './wafer-client.ts';
export { createMetaModel } from './meta-client.ts';
export type { MetaProviderConfig } from './meta-client.ts';
export {
	getOpenRouterInstance,
	createOpenRouterModel,
} from './openrouter-client.ts';
export type { OpenRouterProviderConfig } from './openrouter-client.ts';
export { createOpencodeModel } from './opencode-client.ts';
export type { OpencodeProviderConfig } from './opencode-client.ts';
export { createKimiModel, readKimiApiKeyFromEnv } from './kimi-client.ts';
export type { KimiProviderConfig } from './kimi-client.ts';
export { createMinimaxModel } from './minimax-client.ts';
export type { MinimaxProviderConfig } from './minimax-client.ts';
export { createCopilotFetch, createCopilotModel } from './copilot-client.ts';
export type { CopilotOAuthConfig } from './copilot-client.ts';
export {
	DEFAULT_PROVIDER_REQUEST_MAX_RETRIES,
	DEFAULT_PROVIDER_REQUEST_RETRY_DELAY_MS,
	DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
	DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS,
	ProviderStreamIdleTimeoutError,
	createResilientFetch,
	getProviderRequestMaxRetries,
	getProviderRequestRetryDelayMs,
	getProviderRequestTimeoutMs,
	getProviderStreamIdleTimeoutMs,
	isNonReplayableRequestBody,
	isProviderStreamIdleTimeoutError,
	resilientFetch,
	withStreamIdleTimeout,
} from './resilient-fetch.ts';
export type {
	FetchLike,
	ResilientFetchOptions,
} from './resilient-fetch.ts';
