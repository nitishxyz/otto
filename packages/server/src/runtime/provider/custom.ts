import {
	getConfiguredProviderApiKey,
	type getProviderDefinition,
	type OttoConfig,
} from '@ottocode/sdk';
import { createConfiguredProviderModel } from '@ottocode/sdk/providers';
import { providerFetch } from './fetch.ts';

export function resolveCustomConfiguredModel(
	definition: NonNullable<ReturnType<typeof getProviderDefinition>>,
	cfg: OttoConfig,
	model: string,
	options?: { reasoningText?: boolean; apiKey?: string },
) {
	return createConfiguredProviderModel(definition, model, {
		apiKey: options?.apiKey ?? getConfiguredProviderApiKey(cfg, definition.id),
		customFetch: providerFetch,
		reasoningText: options?.reasoningText,
	});
}
