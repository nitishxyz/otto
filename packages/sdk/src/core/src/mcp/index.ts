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

export { MCPClientWrapper, type MCPToolInfo } from './client.ts';

export { MCPServerManager } from './server-manager.ts';

export { convertMCPToolsToAISDK } from './tools.ts';

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
