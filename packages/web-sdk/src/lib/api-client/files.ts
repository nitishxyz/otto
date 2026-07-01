import {
	listFiles as apiListFiles,
	searchFiles as apiSearchFiles,
	getFileTree as apiGetFileTree,
	readFile as apiReadFile,
	getSessionFiles as apiGetSessionFiles,
} from '@ottocode/api';
import type { SessionFilesResponse } from '../../types/api';
import { extractErrorMessage, getProjectQuery } from './utils';

export const filesMixin = {
	async listFiles() {
		const response = await apiListFiles({ query: getProjectQuery() } as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as {
			files: string[];
			ignoredFiles?: string[];
			changedFiles: Array<{ path: string; status: string }>;
			truncated: boolean;
		};
	},

	async searchFiles(query = '') {
		const response = await apiSearchFiles({
			query: { ...getProjectQuery(), q: query },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as {
			files: string[];
			ignoredFiles?: string[];
			changedFiles: Array<{ path: string; status: string }>;
			truncated: boolean;
		};
	},

	async getFileTree(dirPath = '.'): Promise<{
		items: Array<{
			name: string;
			path: string;
			type: 'file' | 'directory';
			gitignored?: boolean;
			vendor?: boolean;
			searchable?: boolean;
		}>;
		path: string;
		truncated: boolean;
	}> {
		const response = await apiGetFileTree({
			query: { ...getProjectQuery(), path: dirPath },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async readFileContent(filePath: string): Promise<{
		content: string;
		path: string;
		extension: string;
		lineCount: number;
	}> {
		const response = await apiReadFile({
			query: { ...getProjectQuery(), path: filePath },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async getSessionFiles(sessionId: string): Promise<SessionFilesResponse> {
		const response = await apiGetSessionFiles({
			path: { sessionId },
			query: getProjectQuery(),
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as SessionFilesResponse;
	},
};
