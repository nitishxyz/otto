export {
	completeMCPAuth,
	getMCPAuthStatus,
	initiateMCPAuth,
	revokeMCPAuth,
} from './service/auth.ts';
export {
	startMCPServer,
	stopMCPServer,
	testMCPServer,
} from './service/lifecycle.ts';
export {
	addMCPServer,
	buildMCPServerConfig,
	listMCPServers,
	removeMCPServer,
} from './service/servers.ts';
export type {
	CopilotMCPSession,
	MCPAuthSessionOptions,
	MCPAuthStoreOptions,
} from './service/types.ts';
