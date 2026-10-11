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

const injectedEnv = new Map<string, string>();

/**
 * Read an environment variable set by the user, ignoring values that otto
 * copied from stored auth into `process.env` at runtime.
 */
export function readUserEnv(name: string): string | undefined {
	if (typeof process === 'undefined') return undefined;
	const value = process.env[name];
	if (!value?.length) return undefined;
	if (injectedEnv.get(name) === value) return undefined;
	return value;
}

/** Set an environment variable on behalf of stored/configured credentials. */
export function injectEnv(name: string, value: string) {
	process.env[name] = value;
	injectedEnv.set(name, value);
}

function injectedEnvNames(provider: ProviderId): string[] {
	if (provider === 'kimi') return ['KIMI_API_KEY'];
	const key = providerEnvVar(provider);
	return key ? [key] : [];
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
		const value = readUserEnv(key);
		if (value) return value;
	}
	return undefined;
}

export function setEnvKey(provider: ProviderId, value: string | undefined) {
	if (!value) return;
	for (const name of injectedEnvNames(provider)) injectEnv(name, value);
}

/** Remove a provider key that otto injected; user-provided env is untouched. */
export function clearEnvKey(provider: ProviderId) {
	for (const name of injectedEnvNames(provider)) {
		const injected = injectedEnv.get(name);
		if (injected === undefined) continue;
		if (process.env[name] === injected) delete process.env[name];
		injectedEnv.delete(name);
	}
}
