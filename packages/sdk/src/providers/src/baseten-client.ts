import { createBaseten } from '@ai-sdk/baseten';
import { catalog } from './catalog-merged.ts';

export type BasetenProviderConfig = {
	apiKey?: string;
	baseURL?: string;
	modelURL?: string;
	fetch?: typeof fetch;
};

export function createBasetenModel(
	model: string,
	config?: BasetenProviderConfig,
) {
	const entry = catalog.baseten;
	const instance = createBaseten({
		apiKey: config?.apiKey || process.env.BASETEN_API_KEY || '',
		baseURL: config?.baseURL || entry?.api,
		modelURL: config?.modelURL,
		fetch: config?.fetch,
	});

	return instance(model);
}
