import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { catalog } from './catalog-merged.ts';

export type DeepSeekProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	fetch?: typeof fetch;
};

export function createDeepSeekModel(
	model: string,
	config?: DeepSeekProviderConfig,
) {
	const entry = catalog.deepseek;
	const baseURL = config?.baseURL || entry?.api || 'https://api.deepseek.com';
	const apiKey = config?.apiKey || process.env.DEEPSEEK_API_KEY || '';
	const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;

	const instance = createOpenAICompatible({
		name: entry?.label ?? 'DeepSeek',
		baseURL,
		headers,
		fetch: config?.fetch,
	});

	return instance(model);
}
