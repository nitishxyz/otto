import { createHuggingFace } from '@ai-sdk/huggingface';
import { catalog } from './catalog-merged.ts';

export type HuggingFaceProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	fetch?: typeof fetch;
};

export function createHuggingFaceModel(
	model: string,
	config?: HuggingFaceProviderConfig,
) {
	const entry = catalog.huggingface;
	const instance = createHuggingFace({
		apiKey:
			config?.apiKey ||
			process.env.HF_TOKEN ||
			process.env.HUGGINGFACE_API_KEY ||
			'',
		baseURL: config?.baseURL || entry?.api,
		fetch: config?.fetch,
	});

	return instance(model);
}
