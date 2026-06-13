import {
	getSkillsConfig as apiGetSkillsConfig,
	updateSkillsConfig as apiUpdateSkillsConfig,
	listSkills as apiListSkills,
	getSkill as apiGetSkill,
	listSkillFiles as apiListSkillFiles,
	getSkillFile as apiGetSkillFile,
} from '@ottocode/api';
import { extractErrorMessage } from './utils';

export interface SkillSummary {
	name: string;
	description: string;
	scope: string;
	path: string;
	enabled?: boolean;
}

export interface SkillsConfigResponse {
	enabled: boolean;
	totalCount: number;
	enabledCount: number;
	items: SkillSummary[];
}

export interface SkillDetail {
	name: string;
	description: string;
	license?: string | null;
	compatibility?: string | null;
	metadata?: unknown;
	allowedTools?: string[] | null;
	path: string;
	scope: string;
	content: string;
}

export interface SkillFileInfo {
	relativePath: string;
	size: number;
}

export const skillsMixin = {
	async listSkills(): Promise<{ skills: SkillSummary[] }> {
		const response = await apiListSkills();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as { skills: SkillSummary[] };
	},

	async getSkill(name: string): Promise<SkillDetail> {
		const response = await apiGetSkill({ path: { name } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as SkillDetail;
	},

	async getSkillFiles(name: string): Promise<{ files: SkillFileInfo[] }> {
		const response = await apiListSkillFiles({ path: { name } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as { files: SkillFileInfo[] };
	},

	async getSkillFileContent(
		name: string,
		filePath: string,
	): Promise<{ content: string; path: string }> {
		const response = await apiGetSkillFile({
			path: { name, filePath },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as { content: string; path: string };
	},

	async getSkillsConfig(): Promise<SkillsConfigResponse> {
		const response = await apiGetSkillsConfig();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as SkillsConfigResponse;
	},

	async updateSkillsConfig(input: {
		enabled?: boolean;
		items?: Record<string, { enabled?: boolean }>;
	}): Promise<SkillsConfigResponse> {
		const response = await apiUpdateSkillsConfig({ body: input });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as SkillsConfigResponse;
	},
};
