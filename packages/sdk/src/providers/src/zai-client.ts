import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { catalog } from './catalog-merged.ts';

export type ZaiProviderConfig = {
	apiKey?: string;
	baseURL?: string;
};

export function createZaiModel(model: string, config?: ZaiProviderConfig) {
	const entry = catalog.zai;
	const baseURL =
		config?.baseURL || entry?.api || 'https://api.z.ai/api/paas/v4';
	const apiKey =
		config?.apiKey ||
		process.env.ZAI_API_KEY ||
		process.env.ZHIPU_API_KEY ||
		'';
	const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;

	const instance = createOpenAICompatible({
		name: entry?.label ?? 'Z.AI',
		baseURL,
		headers,
	});

	return instance(model);
}

export function createZaiCodingModel(
	model: string,
	config?: ZaiProviderConfig,
) {
	const entry = catalog['zai-coding'];
	const baseURL =
		config?.baseURL || entry?.api || 'https://api.z.ai/api/coding/paas/v4';
	const apiKey =
		config?.apiKey ||
		process.env.ZAI_CODING_API_KEY ||
		process.env.ZHIPU_API_KEY ||
		'';
	const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;

	const instance = createOpenAICompatible({
		name: entry?.label ?? 'Z.AI Coding',
		baseURL,
		headers,
	});

	return instance(model);
}
