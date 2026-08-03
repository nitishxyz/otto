import { OpenAPIHono } from '@hono/zod-openapi';
import type { BlankEnv } from 'hono/types';
import { cors } from 'hono/cors';
import type { ProviderId, AuthInfo } from '@ottocode/sdk';
import type { ThemeId } from '@ottocode/themes';
import { registerRootRoutes } from './routes/root.ts';
import { registerOpenApiRoute } from './routes/openapi.ts';
import { registerSessionsRoutes } from './routes/sessions.ts';
import { registerSessionMessagesRoutes } from './routes/session-messages.ts';
import { registerSessionStreamRoute } from './routes/session-stream.ts';
import { registerClientEventsRoute } from './routes/client-events.ts';
import { registerProjectEventsRoute } from './routes/project-events.ts';
import { registerAskRoutes } from './routes/ask.ts';
import { registerConfigRoutes } from './routes/config/index.ts';
import { registerFilesRoutes } from './routes/files.ts';
import { registerGitRoutes } from './routes/git/index.ts';
import { registerTerminalsRoutes } from './routes/terminals.ts';
import { registerSessionFilesRoutes } from './routes/session-files.ts';
import { registerBranchRoutes } from './routes/branch.ts';
import { registerResearchRoutes } from './routes/research.ts';
import { registerGoalsRoutes } from './routes/goals.ts';
import { registerSubagentsRoutes } from './routes/subagents.ts';
import { registerShellJobsRoutes } from './routes/shell-jobs.ts';
import { registerSessionApprovalRoute } from './routes/session-approval.ts';
import { registerSessionSecureInputRoute } from './routes/session-secure-input.ts';
import { registerOttoRouterRoutes } from './routes/ottorouter.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerTunnelRoutes } from './routes/tunnel.ts';
import { registerOAuthCallbackProxyRoutes } from './routes/oauth-callback-proxy.ts';
import { registerMCPRoutes } from './routes/mcp.ts';
import { registerProviderUsageRoutes } from './routes/provider-usage.ts';
import { registerDoctorRoutes } from './routes/doctor.ts';
import { registerDebugRuntimeRoute } from './routes/debug-runtime.ts';
import { registerSkillsRoutes } from './routes/skills.ts';
import { registerRecipesRoutes } from './routes/recipes.ts';
import { registerUsageRoutes } from './routes/usage.ts';
import { registerAttachmentRoutes } from './routes/attachments.ts';
import { registerBrowserRoutes } from './routes/browser.ts';
import { registerSimulatorRoutes } from './routes/simulator.ts';
import { registerDictationRoutes } from './routes/dictation.ts';
import { registerPluginsRoutes } from './routes/plugins/index.ts';
import { registerProjectsRoutes } from './routes/projects.ts';
import type {
	AgentConfigEntry,
	AgentToolConfig,
} from './runtime/agent/registry.ts';
import { installAiSdkWarningHandler } from './runtime/ai-sdk-warnings.ts';
import { createErrorResponse } from './runtime/errors/api-error.ts';
import { tunnelAuthMiddleware } from './tunnel-auth.ts';

// Suppress noisy AI SDK provider warnings unless debug mode is enabled.
installAiSdkWarningHandler();

const corsAllowHeaders = [
	'Content-Type',
	'Authorization',
	'X-Requested-With',
	'X-Otto-Project',
	'X-Otto-Project-Id',
	'X-Otto-Server-Token',
	'X-Otto-Share-Token',
	'X-Otto-Owner-Session',
	'Access-Control-Request-Private-Network',
];

const LOCAL_NETWORK_PATTERN =
	/^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d+$/;

function isLocalhostOrigin(origin: string): boolean {
	return (
		origin.startsWith('http://localhost:') ||
		origin.startsWith('http://127.0.0.1:') ||
		origin.startsWith('https://localhost:') ||
		origin.startsWith('https://127.0.0.1:')
	);
}

function applyPrivateNetworkAccessHeaders(app: OpenAPIHono<BlankEnv>) {
	app.use('*', async (c, next) => {
		c.header('Access-Control-Allow-Private-Network', 'true');
		await next();
	});
}

function buildCorsOptions(extraOrigins?: string[]) {
	return {
		origin: (origin: string) => {
			if (isLocalhostOrigin(origin)) return origin;
			if (LOCAL_NETWORK_PATTERN.test(origin)) return origin;
			if (extraOrigins?.includes(origin)) return origin;
			// Default to allowing the origin (can be restricted in production)
			return origin;
		},
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
		allowHeaders: corsAllowHeaders,
		exposeHeaders: ['Content-Length', 'X-Request-Id'],
		credentials: true,
		maxAge: 600,
	};
}

function registerRoutes(app: OpenAPIHono<BlankEnv>) {
	registerRootRoutes(app);
	registerOpenApiRoute(app);
	registerProjectsRoutes(app);
	registerSessionsRoutes(app);
	registerSessionApprovalRoute(app);
	registerSessionSecureInputRoute(app);
	registerSessionMessagesRoutes(app);
	registerSessionStreamRoute(app);
	registerClientEventsRoute(app);
	registerProjectEventsRoute(app);
	registerAskRoutes(app);
	registerConfigRoutes(app);
	registerFilesRoutes(app);
	registerGitRoutes(app);
	registerTerminalsRoutes(app);
	registerSessionFilesRoutes(app);
	registerBranchRoutes(app);
	registerResearchRoutes(app);
	registerGoalsRoutes(app);
	registerSubagentsRoutes(app);
	registerShellJobsRoutes(app);
	registerOttoRouterRoutes(app);
	registerAuthRoutes(app);
	registerOAuthCallbackProxyRoutes(app);
	registerTunnelRoutes(app);
	registerMCPRoutes(app);
	registerProviderUsageRoutes(app);
	registerDoctorRoutes(app);
	registerDebugRuntimeRoute(app);
	registerSkillsRoutes(app);
	registerRecipesRoutes(app);
	registerPluginsRoutes(app);
	registerUsageRoutes(app);
	registerAttachmentRoutes(app);
	registerBrowserRoutes(app);
	registerSimulatorRoutes(app);
	registerDictationRoutes(app);
}

function applyErrorHandler(app: OpenAPIHono<BlankEnv>) {
	app.onError((err, c) => {
		const [body, status] = createErrorResponse(err);
		return c.json(body, status);
	});
}

function initApp() {
	const app = new OpenAPIHono<BlankEnv>();
	applyPrivateNetworkAccessHeaders(app);
	app.use('*', cors(buildCorsOptions()));
	app.use('*', tunnelAuthMiddleware);
	applyErrorHandler(app);
	registerRoutes(app);
	return app;
}

const app = initApp();

export default {
	port: 0,
	fetch: app.fetch,
};

export function createApp() {
	return app;
}

export type StandaloneAppConfig = {
	provider?: ProviderId;
	model?: string;
	defaultAgent?: string;
};

export function createStandaloneApp(_config?: StandaloneAppConfig) {
	const honoApp = new OpenAPIHono<BlankEnv>();
	applyPrivateNetworkAccessHeaders(honoApp);
	honoApp.use('*', cors(buildCorsOptions()));
	honoApp.use('*', tunnelAuthMiddleware);
	applyErrorHandler(honoApp);
	registerRoutes(honoApp);
	return honoApp;
}

/**
 * Embedded app configuration with hybrid fallback:
 * 1. Injected config (highest priority)
 * 2. Environment variables
 * 3. auth.json/config.json files (fallback)
 *
 * All fields are optional - if not provided, falls back to files/env
 */
export type EmbeddedAppConfig = {
	/** Primary provider (optional - falls back to config.json or env) */
	provider?: ProviderId;
	/** Primary model (optional - falls back to config.json) */
	model?: string;
	/** Primary API key (optional - falls back to env vars or auth.json) */
	apiKey?: string;
	/** Default agent (optional - falls back to config.json) */
	agent?: string;
	/** Multi-provider auth (optional - falls back to auth.json) */
	auth?: Record<string, { apiKey: string } | AuthInfo>;
	/** Custom agents (optional - falls back to .otto/agents/) */
	agents?: Record<
		string,
		Omit<AgentConfigEntry, 'tools'> & { tools?: AgentToolConfig }
	>;
	/** Default settings (optional - falls back to config.json) */
	defaults?: {
		provider?: ProviderId;
		model?: string;
		agent?: string;
		toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
		theme?: ThemeId | 'light' | 'dark';
		tuiTheme?: string;
		vimMode?: boolean;
		compactThread?: boolean;
		fontFamily?: string;
		smartEdges?: boolean;
		threadNavigatorRail?: boolean;
		releaseToSend?: boolean;
		fullWidthContent?: boolean;
		notificationsEnabled?: boolean;
		autoCompactThresholdTokens?: number | null;
		coAuthorCommits?: boolean;
	};
	/** Additional CORS origins for proxies/Tailscale (e.g., ['https://myapp.ts.net', 'https://example.com']) */
	corsOrigins?: string[];
};

export function createEmbeddedApp(config: EmbeddedAppConfig = {}) {
	const honoApp = new OpenAPIHono<BlankEnv>();
	applyPrivateNetworkAccessHeaders(honoApp);

	// Store injected config in Hono context for routes to access
	// Config can be empty - routes will fall back to files/env
	honoApp.use('*', async (c, next) => {
		(
			c as unknown as {
				set: (
					key: 'embeddedConfig',
					value: EmbeddedAppConfig | undefined,
				) => void;
			}
		).set('embeddedConfig', config);
		await next();
	});

	honoApp.use('*', cors(buildCorsOptions(config.corsOrigins)));
	honoApp.use('*', tunnelAuthMiddleware);
	applyErrorHandler(honoApp);
	registerRoutes(honoApp);
	return honoApp;
}

export {
	resolveAgentConfig,
	defaultToolConfigForAgent,
	flattenAgentToolConfig,
	BUILTIN_AGENT_NAMES,
	HIDDEN_BUILTIN_AGENT_NAMES,
	isHiddenAgent,
	type AgentToolConfig,
	type AgentToolGroups,
} from './runtime/agent/registry.ts';
export {
	getAgentDetail,
	getAllAgentDetails,
	upsertAgentConfig,
	deleteAgentConfig,
	validateAgentName,
	type AgentDetail,
	type AgentConfigScope,
} from './runtime/agent/config-management.ts';
export {
	composeSystemPrompt,
	type ComposedSystemPrompt,
} from './runtime/prompt/builder.ts';
export {
	buildCapabilitySummary,
	type CapabilitySummaryResult,
	type CapabilitySummaryMCPTool,
} from './runtime/prompt/capabilities.ts';
export {
	AskServiceError,
	handleAskRequest,
	deriveStatusFromMessage,
	inferStatus,
} from './runtime/ask/service.ts';
export { registerSessionsRoutes } from './routes/sessions.ts';
export { registerAskRoutes } from './routes/ask.ts';
export {
	BUILTIN_AGENTS,
	BUILTIN_TOOLS,
	type BuiltinAgent,
	type BuiltinTool,
} from './presets.ts';

// Export debug state management
export {
	setDebugEnabled,
	isDebugEnabled,
	setTraceEnabled,
	isTraceEnabled,
} from './runtime/debug/state.ts';
export { logger } from '@ottocode/sdk';

// Export server state management
export {
	setDaemonId,
	setDefaultProjectRoot,
	setServerPort,
	setServerVersion,
	getDefaultProjectRoot,
	getServerPort,
	getServerInfo,
} from './state.ts';
export {
	setDaemonRestartHandler,
	type DaemonRestartRequest,
} from './daemon-restart.ts';
export { shutdownProjectManager } from './runtime/projects/manager.ts';
export {
	restoreManagedTunnel,
	shutdownActiveTunnels,
} from './routes/tunnel/service.ts';

// Export WebSocket handler for Bun.serve()
export { websocket as bunWebSocket } from './ws.ts';
