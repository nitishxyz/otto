import {
	getUsageStats as apiGetUsageStats,
	getGlobalUsageStats as apiGetGlobalUsageStats,
	type UsageStats,
} from '@ottocode/api';
import { extractErrorMessage } from './utils';

export type { UsageStats };
export type UsageTotals = UsageStats['totals'];
export type UsageProviderAgg = UsageStats['providers'][number];
export type UsageModelAgg = UsageStats['models'][number];
export type UsageDailyAgg = UsageStats['daily'][number];
export type UsageProjectsBreakdown = NonNullable<UsageStats['projects']>;
export type UsageProjectInfo = UsageProjectsBreakdown['included'][number];
export type UsageProjectUnavailable =
	UsageProjectsBreakdown['unavailable'][number];

export type UsageAuthBucket = 'oauth' | 'api' | 'subscription';

/** Omit `days` for all-time; otherwise every aggregate is scoped to the window. */
export interface UsageStatsOptions {
	days?: number;
}

export const usageMixin = {
	async getUsageStats(options: UsageStatsOptions = {}): Promise<UsageStats> {
		const { data, error } = await apiGetUsageStats({
			query: options.days ? { days: options.days } : undefined,
		});
		if (error) throw new Error(extractErrorMessage(error));
		if (!data) throw new Error('Empty response from /v1/usage/stats');
		return data;
	},
	async getGlobalUsageStats(
		options: UsageStatsOptions = {},
	): Promise<UsageStats> {
		const { data, error } = await apiGetGlobalUsageStats({
			query: options.days ? { days: options.days } : undefined,
		});
		if (error) throw new Error(extractErrorMessage(error));
		if (!data) throw new Error('Empty response from /v1/usage/stats/global');
		return data;
	},
};
