export type {
	MCPServerConfig,
	MCPServerSource,
	MCPServerSourceKind,
	MCPConfig,
	MCPServerStatus,
	MCPTransport,
	MCPOAuthConfig,
	MCPScope,
} from './types.ts';

export {
	MCPClientWrapper,
	type MCPToolAnnotations,
	type MCPToolInfo,
} from './client.ts';

export { MCPServerManager } from './server-manager.ts';

export { convertMCPToolsToAISDK } from './tools.ts';

export {
	classifyMCPTools,
	classifyFromAnnotations,
	classificationToEffects,
	getMCPClassificationCachePath,
	mcpToolClassificationKey,
	type ClassifyMCPToolsOptions,
	type MCPToolClassification,
	type MCPToolClassificationInput,
	type MCPToolEffectClass,
} from './classify.ts';

export {
	clearMCPToolClassifications,
	getCachedMCPToolClassifications,
	resolveMCPToolClassifications,
} from './classification-registry.ts';

export {
	selectMCPToolsForRequest,
	type MCPPreloadInput,
	type MCPPreloadOptions,
	type MCPPreloadResult,
} from './preload.ts';

export {
	COPILOT_MCP_SCOPE,
	getCopilotMCPOAuthKey,
	getStoredCopilotMCPToken,
	hasCopilotMCPScopes,
	isGitHubCopilotUrl,
	isStoredCopilotMCPAuthenticated,
} from './copilot-auth.ts';

export {
	getMCPToolBriefs,
	buildLoadMCPToolsTool,
	getMCPToolsRecord,
	buildMCPToolCatalogDescription,
	type MCPToolBrief,
	type MCPToolCatalogOptions,
} from './lazy-tools.ts';

export {
	getMCPManager,
	getActiveMCPProjectRoots,
	initializeMCP,
	ensureMCPManager,
	reloadMCPManager,
	shutdownMCP,
	loadMCPConfig,
	addMCPServerToConfig,
	setMCPServerDisabled,
	removeMCPServerFromConfig,
} from './lifecycle.ts';
export {
	formatMcpServerSourceLabel,
	isPluginManagedMcpServer,
	loadEffectiveMCPConfig,
} from './effective-config.ts';

export {
	OAuthCredentialStore,
	OttoOAuthProvider,
	OAuthCallbackServer,
	type StoredOAuthData,
	type OttoOAuthProviderOptions,
	type CallbackResult,
} from './oauth/index.ts';
