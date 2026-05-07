import { OAuthCredentialStore } from '@ottocode/sdk';

export const copilotMCPOAuthStore = new OAuthCredentialStore();

export const copilotMCPSessions = new Map<
	string,
	{
		deviceCode: string;
		interval: number;
		serverName: string;
		createdAt: number;
	}
>();
