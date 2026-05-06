import { createXai } from '@ai-sdk/xai';
import { catalog } from './catalog-merged.ts';

export type XaiProviderConfig = {
	apiKey?: string;
	baseURL?: string;
};

export function createXaiModel(model: string, config?: XaiProviderConfig) {
	const entry = catalog.xai;
	const apiKey = config?.apiKey || process.env.XAI_API_KEY || '';
	const baseURL = config?.baseURL || entry?.api;
	const instance = createXai({ apiKey, baseURL });
	return instance(model);
}
