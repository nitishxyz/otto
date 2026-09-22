import {
	getJudgeConfig as apiGetJudgeConfig,
	updateJudgeConfig as apiUpdateJudgeConfig,
} from '@ottocode/api';
import { extractErrorMessage } from './utils';

export type JudgeMcpSettings = {
	classifyTools: boolean;
	preloadTools: boolean;
	preloadThreshold: number;
};

export type JudgeConfigSettings = {
	enabled: boolean;
	provider: 'typesafe';
	baseURL: string;
	model: string;
	timeoutMs: number;
	mcp: JudgeMcpSettings;
};

export type JudgeCredential = {
	configured: boolean;
	source: 'env' | 'stored' | 'none';
	envVar: string;
};

export type JudgeConfigResponse = {
	settings: JudgeConfigSettings;
	credential: JudgeCredential;
	defaults: {
		baseURL: string;
		model: string;
		timeoutMs: number;
		preloadThreshold: number;
	};
};

export type JudgeConfigUpdate = {
	enabled?: boolean;
	baseURL?: string;
	model?: string;
	timeoutMs?: number;
	mcp?: Partial<JudgeMcpSettings>;
	/** New API key; empty string clears the stored credential. */
	apiKey?: string;
};

export const judgeMixin = {
	async getJudgeConfig(): Promise<JudgeConfigResponse> {
		const response = await apiGetJudgeConfig({});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as JudgeConfigResponse;
	},

	async updateJudgeConfig(
		update: JudgeConfigUpdate,
	): Promise<JudgeConfigResponse> {
		const response = await apiUpdateJudgeConfig({ body: update });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as JudgeConfigResponse;
	},
};
