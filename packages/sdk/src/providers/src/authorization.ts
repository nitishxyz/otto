import {
	isAuthorized as mgrIsAuthorized,
	ensureEnv as mgrEnsureEnv,
} from '../../config/src/index.ts';
import type { OttoConfig } from '../../config/src/index.ts';
import type { ProviderId } from '../../types/src/index.ts';
import {
	getConfiguredProviderApiKey,
	getConfiguredProviderEnvVar,
	getProviderDefinition,
	isBuiltInProviderId,
} from './registry.ts';
import { injectEnv, readUserEnv } from './env.ts';

export async function isProviderAuthorized(
	cfg: OttoConfig,
	provider: ProviderId,
) {
	const definition = getProviderDefinition(cfg, provider);
	if (!definition) return false;
	if (
		definition.source === 'custom' &&
		cfg.providers[String(provider)]?.enabled === false
	)
		return false;
	if (getConfiguredProviderApiKey(cfg, provider)) return true;
	if (definition.apiKeyEnv && readUserEnv(definition.apiKeyEnv)) return true;
	if (!isBuiltInProviderId(provider)) {
		return !definition.apiKeyEnv && !cfg.providers[String(provider)]?.apiKey;
	}
	return await mgrIsAuthorized(provider, cfg.projectRoot);
}

export async function ensureProviderEnv(cfg: OttoConfig, provider: ProviderId) {
	const envVar = getConfiguredProviderEnvVar(cfg, provider);
	const apiKey = getConfiguredProviderApiKey(cfg, provider);
	if (envVar && apiKey && !readUserEnv(envVar)) {
		injectEnv(envVar, apiKey);
	}
	if (isBuiltInProviderId(provider)) {
		await mgrEnsureEnv(provider, cfg.projectRoot);
	}
}
