import { createOpenAI } from '@ai-sdk/openai';
import { catalog } from './catalog-merged.ts';

export type MetaProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	fetch?: typeof fetch;
};

export function createMetaModel(model: string, config?: MetaProviderConfig) {
	const entry = catalog.meta;
	const baseURL = config?.baseURL || entry?.api || 'https://api.meta.ai/v1';
	const apiKey = config?.apiKey || process.env.META_MODEL_API_KEY || '';

	const instance = createOpenAI({
		apiKey,
		baseURL,
		fetch: config?.fetch,
	});

	return instance.chat(model);
}
