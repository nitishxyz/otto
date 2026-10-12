import type { ProviderId } from '../../types/src/provider.ts';
import { catalog } from './catalog-merged.ts';
import { isBuiltInProviderId } from './registry.ts';

export { CACHE_USAGE_NORMALIZATION_MARKER } from '@ottocode/database/markers';

/** Resolves router models to the provider usage contract used by AI SDK. */
export function resolveUsageProvider(
	provider: ProviderId,
	model: string,
): ProviderId {
	if (
		provider !== 'ottorouter' &&
		provider !== 'openrouter' &&
		provider !== 'opencode'
	) {
		return provider;
	}
	const entry = isBuiltInProviderId(provider) ? catalog[provider] : undefined;
	const normalizedModel = model.includes('/') ? model.split('/').at(-1) : model;
	const modelEntry = Object.values(entry?.models ?? {}).find(
		(modelConfig: { id?: string }) =>
			modelConfig.id?.toLowerCase() === normalizedModel?.toLowerCase(),
	);
	const npm = modelEntry?.provider?.npm ?? '';
	if (npm.includes('openai')) return 'openai';
	if (npm.includes('anthropic')) return 'anthropic';
	if (npm.includes('google')) return 'google';
	if (npm.includes('zai')) return 'zai';
	return provider;
}
