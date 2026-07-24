import {
	getConfiguredProviderApiKey,
	getConfiguredProviderIds,
	getProviderDefinition,
	getProviderSettings,
	readEnvKey,
	type ProviderId,
	isProviderAuthorized,
	getAuth,
} from '@ottocode/sdk';
import type { EmbeddedAppConfig } from '../../index.ts';
import type { OttoConfig } from '@ottocode/sdk';
export { discoverAllAgents } from '../../runtime/agent/registry.ts';

export type ProviderDetail = {
	id: string;
	label: string;
	source: 'built-in' | 'custom';
	enabled: boolean;
	authorized: boolean;
	custom: boolean;
	compatibility?: string;
	family?: string;
	baseURL?: string;
	apiKeyEnv?: string;
	hasApiKey: boolean;
	allowAnyModel: boolean;
	modelCount: number;
	authType?: 'api' | 'oauth' | 'wallet';
};

export async function isProviderAuthorizedHybrid(
	embeddedConfig: EmbeddedAppConfig | undefined,
	fileConfig: OttoConfig,
	provider: ProviderId,
): Promise<boolean> {
	const hasEmbeddedAuth =
		embeddedConfig?.provider === provider ||
		(embeddedConfig?.auth && provider in embeddedConfig.auth);

	if (hasEmbeddedAuth) {
		return true;
	}

	return await isProviderAuthorized(fileConfig, provider);
}

export async function getAuthorizedProviders(
	embeddedConfig: EmbeddedAppConfig | undefined,
	fileConfig: OttoConfig,
): Promise<ProviderId[]> {
	const allProviders = getConfiguredProviderIds(fileConfig);
	const authorizedProviders: ProviderId[] = [];

	for (const provider of allProviders) {
		const authorized = await isProviderAuthorizedHybrid(
			embeddedConfig,
			fileConfig,
			provider,
		);
		if (authorized) {
			authorizedProviders.push(provider);
		}
	}

	return authorizedProviders;
}

export async function getProviderDetails(
	embeddedConfig: EmbeddedAppConfig | undefined,
	fileConfig: OttoConfig,
): Promise<ProviderDetail[]> {
	const providers = Array.from(
		new Set<ProviderId>([
			...getConfiguredProviderIds(fileConfig, { includeDisabled: true }),
			...(embeddedConfig?.provider ? [embeddedConfig.provider] : []),
			...((embeddedConfig?.auth
				? (Object.keys(embeddedConfig.auth) as ProviderId[])
				: []) as ProviderId[]),
		]),
	);
	const details = await Promise.all(
		providers.map(async (provider): Promise<ProviderDetail | null> => {
			const definition = getProviderDefinition(fileConfig, provider);
			if (!definition) return null;
			const settings = getProviderSettings(fileConfig, provider);
			const authorized = await isProviderAuthorizedHybrid(
				embeddedConfig,
				fileConfig,
				provider,
			);
			const authType = await getAuthTypeForProvider(
				embeddedConfig,
				provider,
				fileConfig.projectRoot,
				fileConfig,
			);
			return {
				id: provider,
				label: definition.label,
				source: definition.source,
				enabled: settings?.enabled !== false,
				authorized,
				custom: definition.source === 'custom',
				compatibility: definition.compatibility,
				family: definition.family,
				baseURL: definition.baseURL,
				apiKeyEnv: definition.apiKeyEnv,
				hasApiKey: Boolean(getConfiguredProviderApiKey(fileConfig, provider)),
				allowAnyModel: definition.allowAnyModel,
				modelCount: Object.keys(definition.models).length,
				authType,
			} satisfies ProviderDetail;
		}),
	);
	return details.filter((detail) => detail !== null);
}

export function getDefault<T>(
	embeddedValue: T | undefined,
	embeddedDefaultValue: T | undefined,
	fileValue: T,
): T {
	return embeddedValue ?? embeddedDefaultValue ?? fileValue;
}

export async function getAuthTypeForProvider(
	embeddedConfig: EmbeddedAppConfig | undefined,
	provider: ProviderId,
	projectRoot: string,
	fileConfig?: OttoConfig,
): Promise<'api' | 'oauth' | 'wallet' | undefined> {
	if (embeddedConfig?.auth?.[provider]) {
		const embeddedAuth = embeddedConfig.auth[provider];
		return 'type' in embeddedAuth ? embeddedAuth.type : 'api';
	}
	const auth = await getAuth(provider, projectRoot);
	if (auth) return auth.type as 'api' | 'oauth' | 'wallet';
	if (readEnvKey(provider)) return 'api';
	if (fileConfig && getConfiguredProviderApiKey(fileConfig, provider))
		return 'api';
	return undefined;
}
