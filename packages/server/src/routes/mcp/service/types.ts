import type { OAuthCredentialStore } from '@ottocode/sdk';

export type CopilotMCPSession = {
	deviceCode: string;
	interval: number;
	serverName: string;
	projectRoot: string;
	createdAt: number;
};

export type MCPAuthSessionOptions = {
	name: string;
	projectRoot?: string;
	oAuthStore: OAuthCredentialStore;
	sessions: Map<string, CopilotMCPSession>;
};

export type MCPAuthStoreOptions = {
	name: string;
	projectRoot?: string;
	oAuthStore: OAuthCredentialStore;
};
