import { getOpenRouterInstance, createOpenRouterModel } from '@ottocode/sdk';
import { providerFetch } from './fetch.ts';

export { getOpenRouterInstance };

export function resolveOpenRouterModel(model: string) {
	return createOpenRouterModel(model, { fetch: providerFetch });
}
