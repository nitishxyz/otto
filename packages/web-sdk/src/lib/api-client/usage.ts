import {
	getUsageStats as apiGetUsageStats,
	getGlobalUsageStats as apiGetGlobalUsageStats,
	type UsageStats,
	type UsageProviderAgg,
	type UsageModelAgg,
	type UsageDailyAgg,
	type UsageProjectInfo,
	type UsageProjectUnavailable,
	type UsageProjectsBreakdown,
	type UsageTotals,
} from '@ottocode/api';
import { extractErrorMessage } from './utils';

export type {
	UsageStats,
	UsageProviderAgg,
	UsageModelAgg,
	UsageDailyAgg,
	UsageProjectInfo,
	UsageProjectUnavailable,
	UsageProjectsBreakdown,
	UsageTotals,
};

export type UsageAuthBucket = 'oauth' | 'api' | 'subscription';

export const usageMixin = {
	async getUsageStats(): Promise<UsageStats> {
		const { data, error } = await apiGetUsageStats();
		if (error) throw new Error(extractErrorMessage(error));
		if (!data) throw new Error('Empty response from /v1/usage/stats');
		return data;
	},
	async getGlobalUsageStats(): Promise<UsageStats> {
		const { data, error } = await apiGetGlobalUsageStats();
		if (error) throw new Error(extractErrorMessage(error));
		if (!data) throw new Error('Empty response from /v1/usage/stats/global');
		return data;
	},
};
