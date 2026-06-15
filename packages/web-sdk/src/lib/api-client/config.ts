import {
	getConfig as apiGetConfig,
	getProviderModels as apiGetProviderModels,
	getAllModels as apiGetAllModels,
	getAgentDetails as apiGetAgentDetails,
	getAgent as apiGetAgent,
	getConfigTools as apiGetConfigTools,
	upsertAgent as apiUpsertAgent,
	deleteAgent as apiDeleteAgent,
	discoverProviderModels as apiDiscoverProviderModels,
	updateDefaults as apiUpdateDefaults,
	updateProviderSettings as apiUpdateProviderSettings,
	deleteProviderSettings as apiDeleteProviderSettings,
} from '@ottocode/api';
import type {
	GetAgentDetailsResponse,
	GetAgentResponse,
	GetConfigToolsResponse,
	UpsertAgentData,
	UpsertAgentResponse,
	DeleteAgentResponse,
} from '@ottocode/api';
import type { AllModelsResponse } from '../../types/api';
import { extractErrorMessage } from './utils';

type ProviderCompatibility =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'openrouter'
	| 'ollama'
	| 'openai-compatible';

export type DiscoveredProviderModel = {
	id: string;
	label: string;
	toolCall?: boolean;
	reasoningText?: boolean;
	vision?: boolean;
	attachment?: boolean;
	contextWindow?: number;
	maxOutputTokens?: number;
};

export type AgentDetail = GetAgentResponse['agent'];

export type AgentToolGroups = {
	firstClass?: string[];
	loadable?: string[];
};

export type AgentToolConfig = AgentToolGroups;

export type UpdateAgentInput = UpsertAgentData['body'];

export type ToolDetail = GetConfigToolsResponse['tools'][number];

export const configMixin = {
	async getConfig(): Promise<{
		agents: string[];
		providers: string[];
		defaults: {
			agent: string;
			provider: string;
			model: string;
			toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
			guidedMode?: boolean;
			reasoningText?: boolean;
			reasoningLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
			theme?: 'light' | 'dark';
			tuiTheme?: string;
			vimMode?: boolean;
			compactThread?: boolean;
			fontFamily?: string;
			smartEdges?: boolean;
			releaseToSend?: boolean;
			fullWidthContent?: boolean;
			autoCompactThresholdTokens?: number | null;
			coAuthorCommits?: boolean;
			ottoEnabled?: boolean;
		};
	}> {
		const response = await apiGetConfig();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async getAgentDetails(): Promise<GetAgentDetailsResponse> {
		const response = await apiGetAgentDetails();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as GetAgentDetailsResponse;
	},

	async getAgent(name: string): Promise<GetAgentResponse> {
		const response = await apiGetAgent({ path: { agent: name } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as GetAgentResponse;
	},

	async getConfigTools(): Promise<GetConfigToolsResponse> {
		const response = await apiGetConfigTools();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as GetConfigToolsResponse;
	},

	async updateAgent(
		name: string,
		input: UpdateAgentInput,
	): Promise<UpsertAgentResponse> {
		const response = await apiUpsertAgent({
			path: { agent: name },
			body: input,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as UpsertAgentResponse;
	},

	async deleteAgent(
		name: string,
		scope: 'local' | 'global' = 'local',
	): Promise<DeleteAgentResponse> {
		const response = await apiDeleteAgent({
			path: { agent: name },
			query: { scope },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as DeleteAgentResponse;
	},

	async getModels(providerId: string): Promise<{
		models: Array<{
			id: string;
			label: string;
			toolCall?: boolean;
			reasoningText?: boolean;
			vision?: boolean;
			attachment?: boolean;
			free?: boolean;
			contextWindow?: number;
			maxOutputTokens?: number;
			available?: boolean;
			unavailableReason?: string;
		}>;
		default: string;
		allowAnyModel?: boolean;
		dynamicModels?: boolean;
		label?: string;
	}> {
		const response = await apiGetProviderModels({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			path: { provider: providerId as any },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async getAllModels(): Promise<AllModelsResponse> {
		const response = await apiGetAllModels();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as AllModelsResponse;
	},

	async discoverProviderModels(data: {
		compatibility: ProviderCompatibility;
		baseURL: string;
		apiKey?: string;
	}): Promise<{
		baseURL?: string;
		models: DiscoveredProviderModel[];
		unsupported?: boolean;
		message?: string;
	}> {
		const response = await apiDiscoverProviderModels({
			body: data,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as {
			baseURL?: string;
			models: DiscoveredProviderModel[];
			unsupported?: boolean;
			message?: string;
		};
	},

	async updateProviderSettings(
		provider: string,
		data: {
			enabled?: boolean;
			custom?: boolean;
			label?: string;
			compatibility?: ProviderCompatibility;
			baseURL?: string | null;
			apiKey?: string | null;
			models?: string[];
			allowAnyModel?: boolean;
		},
	): Promise<{ success: boolean; provider: string }> {
		const response = await apiUpdateProviderSettings({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			path: { provider: provider as any },
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: data as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async deleteProviderSettings(
		provider: string,
	): Promise<{ success: boolean; provider: string }> {
		const response = await apiDeleteProviderSettings({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			path: { provider: provider as any },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async updateDefaults(data: {
		agent?: string;
		provider?: string;
		model?: string;
		toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
		guidedMode?: boolean;
		reasoningText?: boolean;
		reasoningLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
		theme?: 'light' | 'dark';
		tuiTheme?: string;
		vimMode?: boolean;
		compactThread?: boolean;
		fontFamily?: string;
		smartEdges?: boolean;
		releaseToSend?: boolean;
		fullWidthContent?: boolean;
		autoCompactThresholdTokens?: number | null;
		coAuthorCommits?: boolean;
		ottoEnabled?: boolean;
		scope?: 'global' | 'local';
	}): Promise<{
		success: boolean;
		defaults: {
			agent: string;
			provider: string;
			model: string;
			toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
			guidedMode?: boolean;
			reasoningText?: boolean;
			reasoningLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
			theme?: 'light' | 'dark';
			tuiTheme?: string;
			vimMode?: boolean;
			compactThread?: boolean;
			fontFamily?: string;
			smartEdges?: boolean;
			releaseToSend?: boolean;
			fullWidthContent?: boolean;
			autoCompactThresholdTokens?: number | null;
			coAuthorCommits?: boolean;
			ottoEnabled?: boolean;
		};
	}> {
		const response = await apiUpdateDefaults({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { scope: 'global', ...data } as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},
};
