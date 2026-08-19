// =======================
// Core AI Functions (from AI SDK)
// =======================
export {
	generateText,
	streamText,
	generateObject,
	streamObject,
	tool,
} from 'ai';
export type { ModelMessage, Tool } from 'ai';

// =======================
// Provider & Model Resolution
// =======================
export { resolveModel } from './providers/resolver';
export type { ProviderName, ModelConfig } from './providers/resolver';

// Re-export provider catalog and utilities for easy access
export {
	catalog,
	providerIds,
	isProviderId,
	isProviderAuthorized,
	validateProviderModel,
} from '../../providers/src/index.ts';
export type { ProviderId, ModelInfo } from '../../types/src/index.ts';

// =======================
// Tools
// =======================
export { discoverProjectTools } from './tools/loader';
export type { DiscoveredTool, DiscoverResult } from './tools/loader';
export { getToolMetadata, setToolMetadata } from './tools/metadata';
export type { ToolMetadata, ToolSourceKind } from './tools/metadata';
export { runNativeExtensionHost } from './tools/extensions/host';
export {
	disposeNativeExtensionHosts,
	executeNativeExtension,
} from './tools/extensions/client';
export {
	executeNativePluginTool,
	validateNativePlugin,
} from './tools/extensions/development';
export type { NativePluginValidation } from './tools/extensions/development';
export {
	setTerminalManager,
	unsetTerminalManager,
	getTerminalManager,
	clearProjectToolDiscoveryCache,
} from './tools/loader';
export { shellExecutorContext } from './tools/builtin/shell';
export type { ShellExecutor } from './tools/builtin/shell';

// Tool error handling utilities
export {
	isToolError,
	extractToolError,
	createToolError,
} from './tools/error';
export type {
	ToolErrorType,
	ToolErrorResponse,
	ToolSuccessResponse,
	ToolResponse,
} from './tools/error';

// Re-export builtin tools for direct access
export { buildFsTools } from './tools/builtin/fs/index';
export { buildGitTools } from './tools/builtin/git';
export { buildTerminalTool } from './tools/builtin/terminal';
export {
	buildLazyToolsRecord,
	buildLoadFirstPartyToolsTool,
	buildLoadToolsTool,
	buildSimulatorTool,
	getLazyToolDefinitions,
} from './tools/lazy/index';

// =======================
// Terminals
// =======================
export { TerminalManager } from './terminals/index';
export type {
	Terminal,
	TerminalOptions,
	TerminalStatus,
	TerminalCreator,
	CreateTerminalOptions,
} from './terminals/index';

// =======================
// Streaming & Artifacts
// =======================
export {
	createFileDiffArtifact,
	createToolResultPayload,
} from './streaming/artifacts';
export type {
	Artifact,
	FileDiffArtifact,
	FileArtifact,
} from './streaming/artifacts';

// =======================
// Types
// =======================
export type { ExecutionContext, ToolResult } from './types/index';

// =======================
// Schema Validation
// =======================
export { z } from 'zod';

// =======================
// Error Handling
// =======================
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
} from './errors';

// =======================
// Logging & Debug
// =======================
export { logger, debug, info, warn, error, time } from './utils/logger.ts';
export {
	isDebugEnabled,
	isTraceEnabled,
	setDebugEnabled,
	setTraceEnabled,
} from './utils/debug.ts';

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
	getActiveMCPProjectRoots,
	hasCopilotMCPScopes,
	initializeMCP,
	ensureMCPManager,
	reloadMCPManager,
	isGitHubCopilotUrl,
	isStoredCopilotMCPAuthenticated,
	shutdownMCP,
	loadMCPConfig,
	loadEffectiveMCPConfig,
	formatMcpServerSourceLabel,
	isPluginManagedMcpServer,
	addMCPServerToConfig,
	setMCPServerDisabled,
	removeMCPServerFromConfig,
	OAuthCredentialStore,
	OttoOAuthProvider,
	OAuthCallbackServer,
} from './mcp/index.ts';
export type {
	MCPServerConfig,
	MCPServerSource,
	MCPServerSourceKind,
	MCPConfig,
	MCPServerStatus,
	MCPToolInfo,
	MCPTransport,
	MCPOAuthConfig,
	MCPScope,
	StoredOAuthData,
	OttoOAuthProviderOptions,
	CallbackResult,
} from './mcp/index.ts';
