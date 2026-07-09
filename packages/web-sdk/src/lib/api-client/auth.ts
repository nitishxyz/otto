import {
	getAuthStatus as apiGetAuthStatus,
	addProviderApiKey as apiAddProviderApiKey,
	removeProvider as apiRemoveProvider,
	completeOnboarding as apiCompleteOnboarding,
	getOAuthUrl as apiGetOAuthUrl,
	exchangeOAuthCode as apiExchangeOAuthCode,
	startOpenAiDeviceFlow as apiStartOpenAiDeviceFlow,
	pollOpenAiDeviceFlow as apiPollOpenAiDeviceFlow,
	startCopilotDeviceFlow as apiStartCopilotDeviceFlow,
	pollCopilotDeviceFlow as apiPollCopilotDeviceFlow,
	startKimiDeviceFlow as apiStartKimiDeviceFlow,
	pollKimiDeviceFlow as apiPollKimiDeviceFlow,
	getCopilotAuthMethods as apiGetCopilotAuthMethods,
	saveCopilotToken as apiSaveCopilotToken,
	importCopilotTokenFromGh as apiImportCopilotTokenFromGh,
	getCopilotDiagnostics as apiGetCopilotDiagnostics,
	getProviderUsage as apiGetProviderUsage,
} from '@ottocode/api';
import type { ProviderUsageResponse } from '../../types/api';
import { extractErrorMessage, getBaseUrl } from './utils';

export const authMixin = {
	async getAuthStatus(): Promise<{
		onboardingComplete: boolean;
		ottorouter: { configured: boolean; expiresAt?: number };
		providers: Record<
			string,
			{
				configured: boolean;
				type?: 'api' | 'oauth';
				label: string;
				supportsOAuth: boolean;
				supportsToken?: boolean;
				supportsGhImport?: boolean;
				custom?: boolean;
				modelCount: number;
				costRange?: { min: number; max: number };
			}
		>;
		defaults: {
			agent: string;
			provider: string;
			model: string;
			toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
		};
	}> {
		const response = await apiGetAuthStatus();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async addProvider(
		provider: string,
		apiKey: string,
	): Promise<{ success: boolean; provider: string }> {
		const response = await apiAddProviderApiKey({
			path: { provider },
			body: { apiKey },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async removeProvider(
		provider: string,
	): Promise<{ success: boolean; provider: string }> {
		const response = await apiRemoveProvider({ path: { provider } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async completeOnboarding(): Promise<{ success: boolean }> {
		const response = await apiCompleteOnboarding();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	getOAuthStartUrl(provider: string, mode?: string): string {
		const baseUrl = `${getBaseUrl()}/v1/auth/${provider}/oauth/start`;
		if (mode) return `${baseUrl}?mode=${mode}`;
		return baseUrl;
	},

	async getOAuthUrl(
		provider: string,
		mode?: string,
	): Promise<{ url: string; sessionId: string; provider: string }> {
		const response = await apiGetOAuthUrl({
			path: { provider },
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { mode } as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async exchangeOAuthCode(
		provider: string,
		code: string,
		sessionId: string,
	): Promise<{ success: boolean; provider: string }> {
		const response = await apiExchangeOAuthCode({
			path: { provider },
			body: { code, sessionId },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async startOpenAIDeviceFlow(): Promise<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	}> {
		const response = await apiStartOpenAiDeviceFlow();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async pollOpenAIDeviceFlow(
		sessionId: string,
	): Promise<{ status: 'complete' | 'pending' | 'error'; error?: string }> {
		const response = await apiPollOpenAiDeviceFlow({
			body: { sessionId },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async startCopilotDeviceFlow(): Promise<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	}> {
		const response = await apiStartCopilotDeviceFlow();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async pollCopilotDeviceFlow(
		sessionId: string,
	): Promise<{ status: 'complete' | 'pending' | 'error'; error?: string }> {
		const response = await apiPollCopilotDeviceFlow({
			body: { sessionId },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async startKimiDeviceFlow(): Promise<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	}> {
		const response = await apiStartKimiDeviceFlow();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async pollKimiDeviceFlow(
		sessionId: string,
	): Promise<{ status: 'complete' | 'pending' | 'error'; error?: string }> {
		const response = await apiPollKimiDeviceFlow({
			body: { sessionId },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async startOttoRouterDeviceFlow(): Promise<{
		sessionId: string;
		userCode: string;
		verificationUri: string;
		interval: number;
	}> {
		const response = await fetch(
			`${getBaseUrl()}/v1/auth/ottorouter/device/start`,
			{
				method: 'POST',
			},
		);
		if (!response.ok) throw new Error(await response.text());
		return (await response.json()) as {
			sessionId: string;
			userCode: string;
			verificationUri: string;
			interval: number;
		};
	},

	async pollOttoRouterDeviceFlow(
		sessionId: string,
	): Promise<{ status: 'complete' | 'pending' | 'error'; error?: string }> {
		const response = await fetch(
			`${getBaseUrl()}/v1/auth/ottorouter/device/poll`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId }),
			},
		);
		if (!response.ok) throw new Error(await response.text());
		return (await response.json()) as {
			status: 'complete' | 'pending' | 'error';
			error?: string;
		};
	},

	async getCopilotAuthMethods(): Promise<{
		oauth: boolean;
		token: boolean;
		ghImport: { available: boolean; authenticated: boolean; reason?: string };
	}> {
		const response = await apiGetCopilotAuthMethods();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async saveCopilotToken(token: string): Promise<{
		success: boolean;
		provider: string;
		source: 'token';
		modelCount: number;
		hasGpt52Codex: boolean;
		sampleModels: string[];
	}> {
		const response = await apiSaveCopilotToken({ body: { token } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async importCopilotTokenFromGh(): Promise<{
		success: boolean;
		provider: string;
		source: 'gh';
		modelCount: number;
		hasGpt52Codex: boolean;
		sampleModels: string[];
	}> {
		const response = await apiImportCopilotTokenFromGh();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async getCopilotDiagnostics(): Promise<{
		tokenSources: Array<{
			source: 'env' | 'stored';
			configured: boolean;
			modelCount?: number;
			hasGpt52Codex?: boolean;
			sampleModels?: string[];
			restrictedByOrgPolicy?: boolean;
			restrictedOrg?: string;
			restrictionMessage?: string;
			error?: string;
		}>;
		methods: {
			oauth: boolean;
			token: boolean;
			ghImport: { available: boolean; authenticated: boolean; reason?: string };
		};
	}> {
		const response = await apiGetCopilotDiagnostics();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async getProviderUsage(provider: string): Promise<ProviderUsageResponse> {
		const response = await apiGetProviderUsage({
			// biome-ignore lint/suspicious/noExplicitAny: API path type mismatch
			path: { provider } as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as ProviderUsageResponse;
	},
};
