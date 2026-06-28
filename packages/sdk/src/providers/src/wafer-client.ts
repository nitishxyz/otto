import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { catalog } from './catalog-merged.ts';

export type WaferProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	fetch?: typeof fetch;
	zdr?: boolean;
};

export function createWaferModel(model: string, config?: WaferProviderConfig) {
	const entry = catalog.wafer;
	const baseURL = config?.baseURL || entry?.api || 'https://pass.wafer.ai/v1';
	const apiKey = config?.apiKey || process.env.WAFER_API_KEY || '';
	const headers: Record<string, string> = apiKey
		? { Authorization: `Bearer ${apiKey}` }
		: {};
	if (config?.zdr === true) headers['Wafer-ZDR'] = 'required';

	const instance = createOpenAICompatible({
		name: entry?.label ?? 'Wafer',
		baseURL,
		headers,
		fetch: config?.fetch,
	});

	return instance(model);
}
