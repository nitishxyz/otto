// ============================================================================
// @ottocode/sdk - Tree-shakable AI Agent SDK
// ============================================================================
// This is the SINGLE source of truth for all ottocode functionality.
// All exports are tree-shakable - bundlers will only include what you use.
//
// Usage:
//   import { generateText, resolveModel } from '@ottocode/sdk';
//   import type { ProviderId, OttoConfig } from '@ottocode/sdk';
// ============================================================================

// =======================
// Types (from internal types module)
// =======================
// Provider types
export type {
	BuiltInProviderId,
	ProviderId,
	ProviderCompatibility,
	ProviderPromptFamily,
	ModelOwner,
	ModelInfo,
	ModelProviderBinding,
	ProviderCatalogEntry,
} from './types/src/index.ts';

// Auth types
export type { ApiAuth, OAuth, AuthInfo, AuthFile } from './types/src/index.ts';

// Config types
export type {
	DefaultConfig,
	PathConfig,
	ProviderSettingsEntry,
	OttoConfig,
	ReasoningLevel,
} from './types/src/index.ts';

// =======================
// Providers (from internal providers module)
// =======================
export { catalog } from './providers/src/index.ts';
export {
	DEFAULT_REMOTE_MODEL_CATALOG_URL,
	getCachedProviderCatalogEntry,
	getModelCatalogCachePath,
	mergeCachedModelCatalog,
	normalizeModelCatalogPayload,
	readCachedModelCatalog,
	readCachedModelCatalogSync,
	writeCachedModelCatalog,
} from './providers/src/index.ts';
export type {
	CachedModelCatalog,
	CachedProviderCatalogEntry,
} from './providers/src/index.ts';
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
} from './providers/src/index.ts';
export type { UnderlyingProviderKey } from './providers/src/index.ts';
export {
	discoverOllamaModels,
	normalizeOllamaBaseURL,
} from './providers/src/index.ts';
export type {
	DiscoverOllamaOptions,
	DiscoverOllamaResult,
} from './providers/src/index.ts';
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
} from './providers/src/index.ts';
export type { ResolvedProviderDefinition } from './providers/src/index.ts';
export {
	isProviderAuthorized,
	ensureProviderEnv,
} from './providers/src/index.ts';
export { validateProviderModel } from './providers/src/index.ts';
export { estimateModelCostUsd } from './providers/src/index.ts';
export {
	providerEnvVar,
	readEnvKey,
	setEnvKey,
} from './providers/src/index.ts';
export {
	createOttoRouter,
	createOttoRouterFetch,
	createOttoRouterModel,
	fetchOttoRouterBalance,
	getPublicKeyFromPrivate,
	fetchSolanaUsdcBalance,
} from './providers/src/index.ts';
export type {
	OttoRouterAuth,
	OttoRouterInstance,
	OttoRouterProviderOptions,
	OttoRouterPaymentCallbacks,
	OttoRouterBalanceUpdate,
	OttoRouterBalanceResponse,
	SolanaUsdcBalanceResponse,
} from './providers/src/index.ts';
export {
	createOpenAIOAuthFetch,
	createOpenAIOAuthModel,
} from './providers/src/index.ts';
export type { OpenAIOAuthConfig } from './providers/src/index.ts';
export {
	isModelAllowedForOAuth,
	filterModelsForAuthType,
	getOAuthModelPrefixes,
} from './providers/src/index.ts';
export {
	addAnthropicCacheControl,
	createAnthropicCachingFetch,
	createConditionalCachingFetch,
} from './providers/src/index.ts';
export {
	createAnthropicOAuthFetch,
	createAnthropicOAuthModel,
} from './providers/src/index.ts';
export type { AnthropicOAuthConfig } from './providers/src/index.ts';
export { createGoogleModel } from './providers/src/index.ts';
export type { GoogleProviderConfig } from './providers/src/index.ts';
export { createXaiModel } from './providers/src/index.ts';
export type { XaiProviderConfig } from './providers/src/index.ts';
export { createZaiModel, createZaiCodingModel } from './providers/src/index.ts';
export type { ZaiProviderConfig } from './providers/src/index.ts';
export {
	getOpenRouterInstance,
	createOpenRouterModel,
} from './providers/src/index.ts';
export type { OpenRouterProviderConfig } from './providers/src/index.ts';
export { createOpencodeModel } from './providers/src/index.ts';
export type { OpencodeProviderConfig } from './providers/src/index.ts';
export { createMoonshotModel } from './providers/src/index.ts';
export type { MoonshotProviderConfig } from './providers/src/index.ts';
export { createMinimaxModel } from './providers/src/index.ts';
export type { MinimaxProviderConfig } from './providers/src/index.ts';
export {
	createCopilotFetch,
	createCopilotModel,
} from './providers/src/index.ts';
export type { CopilotOAuthConfig } from './providers/src/index.ts';

// =======================
// Authentication (from internal auth module)
// =======================
export {
	getAllAuth,
	getAuth,
	setAuth,
	removeAuth,
	authorize,
	exchange,
	refreshToken,
	openAuthUrl,
	createApiKey,
	authorizeWeb,
	exchangeWeb,
} from './auth/src/index.ts';
export {
	authorizeOpenAI,
	exchangeOpenAI,
	refreshOpenAIToken,
	openOpenAIAuthUrl,
	obtainOpenAIApiKey,
	authorizeOpenAIWeb,
	exchangeOpenAIWeb,
} from './auth/src/index.ts';
export type { OpenAIOAuthResult } from './auth/src/index.ts';
export {
	generateWallet,
	importWallet,
	isValidPrivateKey,
	getOttoRouterWallet,
	ensureOttoRouterWallet,
} from './auth/src/index.ts';
export type { WalletInfo } from './auth/src/index.ts';
export {
	authorizeCopilot,
	pollForCopilotToken,
	pollForCopilotTokenOnce,
	openCopilotAuthUrl,
} from './auth/src/index.ts';
export type {
	CopilotDeviceCodeResponse,
	CopilotPollResult,
} from './auth/src/index.ts';

// =======================
// Configuration (from internal config module)
// =======================
export { loadConfig, read as readConfig } from './config/src/index.ts';
export {
	getLocalDataDir,
	getGlobalConfigDir,
	getGlobalConfigPath,
	getGlobalAgentsJsonPath,
	getGlobalAgentsDir,
	getGlobalToolsDir,
	getGlobalCommandsDir,
	getGlobalDebugDir,
	getGlobalDebugLogPath,
	getGlobalDebugSessionsDir,
	getSessionDebugLogPath,
	getSessionDebugDetailsLogPath,
	getSessionSystemPromptPath,
	getSecureAuthPath,
	getSecureBaseDir,
	getSecureOAuthDir,
	getHomeDir,
} from './config/src/paths.ts';
export {
	read,
	isAuthorized,
	ensureEnv,
	writeDefaults as setConfig,
	writeProviderSettings,
	removeProviderSettings,
	writeSkillSettings,
	readDebugConfig,
	writeDebugConfig,
	writeAuth,
	removeAuth as removeConfig,
	getOnboardingComplete,
	setOnboardingComplete,
} from './config/src/manager.ts';
export type { Scope, DebugConfig } from './config/src/manager.ts';

// =======================
// Prompts (from internal prompts module)
// =======================
export {
	providerBasePrompt,
	type ProviderPromptResult,
} from './prompts/src/providers.ts';

// =======================
// Core AI Functions (from internal core module)
// =======================
// AI SDK re-exports
export {
	generateText,
	streamText,
	generateObject,
	streamObject,
	tool,
} from './core/src/index.ts';
export type { ModelMessage, Tool } from './core/src/index.ts';
// Re-export from AI SDK
export type { ToolCallPart } from 'ai';

// Provider & Model Resolution
export { resolveModel } from './core/src/index.ts';
export type { ProviderName, ModelConfig } from './core/src/index.ts';

// Tools
export { discoverProjectTools } from './core/src/index.ts';
export type { DiscoveredTool, DiscoverResult } from './core/src/index.ts';
export { setTerminalManager, getTerminalManager } from './core/src/index.ts';
export { shellExecutorContext } from './core/src/index.ts';
export type { ShellExecutor } from './core/src/index.ts';
export { createToolError } from './core/src/index.ts';
export { buildFsTools } from './core/src/index.ts';
export { buildGitTools } from './core/src/index.ts';
export {
	appendCoAuthorTrailer,
	injectCoAuthorIntoGitCommit,
	OTTOCODE_BOT_NAME,
	OTTOCODE_BOT_EMAIL,
	OTTOCODE_CO_AUTHOR,
} from './core/src/tools/builtin/git-identity.ts';

// Terminals
export { TerminalManager } from './core/src/index.ts';
export type {
	Terminal,
	TerminalOptions,
	TerminalStatus,
	TerminalCreator,
	CreateTerminalOptions,
} from './core/src/index.ts';

// Streaming & Artifacts
export {
	createFileDiffArtifact,
	createToolResultPayload,
} from './core/src/index.ts';
export type {
	Artifact,
	FileDiffArtifact,
	FileArtifact,
} from './core/src/index.ts';

// Core Types
export type { ExecutionContext, ToolResult } from './core/src/index.ts';

// Error Handling
export {
	OttoError,
	AuthError,
	ConfigError,
	ToolError,
	ProviderError,
	DatabaseError,
	ValidationError,
	NotFoundError,
	ServiceError,
} from './core/src/index.ts';

// Logging & Debug
export {
	logger,
	debug,
	info,
	warn,
	error,
	time,
	isDebugEnabled,
	isTraceEnabled,
	setDebugEnabled,
	setTraceEnabled,
} from './core/src/index.ts';

// Schema Validation
export { z } from './core/src/index.ts';

// =======================
// SDK-specific Agent Types
// =======================
export type { AgentConfig, AgentConfigEntry } from './agent/types.ts';

// =======================
// Skills (from internal skills module)
// =======================
export type {
	SkillScope,
	SkillMetadata,
	SkillDefinition,
	DiscoveredSkill,
	SkillLoadResult,
	SkillErrorResult,
	SkillResult,
	SkillFileInfo,
	SecurityNotice,
} from './skills/index.ts';

export {
	validateMetadata as validateSkillMetadata,
	validateSkillName,
	SkillValidationError,
} from './skills/index.ts';

export { parseSkillFile, extractFrontmatter } from './skills/index.ts';

export {
	discoverSkills,
	loadSkill,
	loadSkillFile,
	discoverSkillFiles,
	getSkillCache,
	clearSkillCache,
	findGitRoot,
	listSkillsInDir,
} from './skills/index.ts';

export {
	initializeSkills,
	getDiscoveredSkills,
	setSkillSettings,
	filterDiscoveredSkills,
	isSkillsInitialized,
	buildSkillTool,
	summarizeDescription,
	rebuildSkillDescription,
} from './skills/index.ts';

export { scanContent as scanSkillContent } from './skills/index.ts';

// =======================
// Tunnel (Cloudflare Tunnels for remote access)
// =======================
export {
	getTunnelBinaryPath,
	isTunnelBinaryInstalled,
	downloadTunnelBinary,
	ensureTunnelBinary,
	removeTunnelBinary,
	OttoTunnel,
	createTunnel,
	killStaleTunnels,
	generateQRCode,
	printQRCode,
} from './tunnel/index.ts';

export type { TunnelConnection, TunnelEvents } from './tunnel/index.ts';

// =======================
// MCP (Model Context Protocol)
// =======================
export {
	MCPClientWrapper,
	MCPServerManager,
	COPILOT_MCP_SCOPE,
	convertMCPToolsToAISDK,
	getCopilotMCPOAuthKey,
	getStoredCopilotMCPToken,
	getMCPManager,
	hasCopilotMCPScopes,
	initializeMCP,
	isGitHubCopilotUrl,
	isStoredCopilotMCPAuthenticated,
	shutdownMCP,
	loadMCPConfig,
	addMCPServerToConfig,
	removeMCPServerFromConfig,
	OAuthCredentialStore,
	OttoOAuthProvider,
	OAuthCallbackServer,
} from './core/src/index.ts';
export type {
	MCPServerConfig,
	MCPConfig,
	MCPServerStatus,
	MCPToolInfo,
	MCPTransport,
	MCPOAuthConfig,
	MCPScope,
	StoredOAuthData,
	OttoOAuthProviderOptions,
	CallbackResult,
} from './core/src/index.ts';
