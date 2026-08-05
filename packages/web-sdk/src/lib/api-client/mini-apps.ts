import {
	buildMiniApp as apiBuildMiniApp,
	listMiniApps as apiListMiniApps,
} from '@ottocode/api';
import { extractErrorMessage } from './utils';

export type MiniAppScope = 'project' | 'global';

export interface MiniAppSummary {
	id: string;
	name: string;
	description?: string;
	runtime: 'otto-react';
	scope: MiniAppScope;
	entry: string;
	revisionId: string;
	permissions: string[];
	capabilities: string[];
	placements: Array<'apps' | 'project' | 'commandPalette'>;
}

export interface MiniAppListResponse {
	apps: MiniAppSummary[];
	projectCount: number;
	globalCount: number;
}

export interface MiniAppBuildResponse {
	app: MiniAppSummary;
	previewPath: string;
	cached: boolean;
}

export const miniAppsMixin = {
	async listMiniApps(): Promise<MiniAppListResponse> {
		const response = await apiListMiniApps();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as MiniAppListResponse;
	},

	async buildMiniApp(
		scope: MiniAppScope,
		appId: string,
	): Promise<MiniAppBuildResponse> {
		const response = await apiBuildMiniApp({ path: { scope, appId } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as MiniAppBuildResponse;
	},
};
