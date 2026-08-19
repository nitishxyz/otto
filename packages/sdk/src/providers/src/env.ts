import type {
	BuiltInProviderDescriptor,
	BuiltInProviderId,
	ProviderId,
} from '../../types/src/index.ts';
import { BUILT_IN_PROVIDER_DESCRIPTORS } from '../../types/src/provider-descriptors.ts';

function getDescriptor(
	provider: ProviderId,
): BuiltInProviderDescriptor | undefined {
	return BUILT_IN_PROVIDER_DESCRIPTORS[provider as BuiltInProviderId];
}

export function providerEnvVar(provider: ProviderId): string | undefined {
	return getDescriptor(provider)?.environment.primary;
}

export function readEnvKey(provider: ProviderId): string | undefined {
	if (provider === 'ottorouter') {
		return undefined;
	}
	const descriptor = getDescriptor(provider);
	if (!descriptor) return undefined;
	const keys =
		provider === 'copilot'
			? [
					...(descriptor.environment.aliases ?? []),
					descriptor.environment.primary,
				]
			: [
					descriptor.environment.primary,
					...(descriptor.environment.aliases ?? []),
				];
	for (const key of keys) {
		const value = typeof process !== 'undefined' ? process.env[key] : undefined;
		if (value?.length) return value;
	}
	return undefined;
}

export function setEnvKey(provider: ProviderId, value: string | undefined) {
	if (!value) return;
	if (provider === 'kimi') {
		process.env.KIMI_API_KEY = value;
		return;
	}
	const key = providerEnvVar(provider);
	if (key) {
		process.env[key] = value;
	}
}
