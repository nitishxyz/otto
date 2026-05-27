import { createXai } from '@ai-sdk/xai';
import { catalog } from './catalog-merged.ts';

export type XaiProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	useResponses?: boolean;
};

function shouldUseXaiResponsesApi(model: string): boolean {
	const normalized = model.toLowerCase().split('/').pop() || model;
	return (
		normalized === 'grok-4.3' ||
		normalized === 'grok-build-0.1' ||
		normalized.startsWith('grok-4.20-')
	);
}

export function createXaiModel(model: string, config?: XaiProviderConfig) {
	const entry = catalog.xai;
	const apiKey = config?.apiKey || process.env.XAI_API_KEY || '';
	const baseURL = config?.baseURL || entry?.api;
	const instance = createXai({ apiKey, baseURL });
	if (config?.useResponses ?? shouldUseXaiResponsesApi(model)) {
		return instance.responses(model);
	}
	return instance(model);
}
