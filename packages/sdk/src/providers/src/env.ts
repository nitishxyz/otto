import type { BuiltInProviderId, ProviderId } from '../../types/src/index.ts';
import { readKimiApiKeyFromEnv } from './kimi-client.ts';

const ENV_VARS: Record<BuiltInProviderId, string> = {
	openai: 'OPENAI_API_KEY',
	anthropic: 'ANTHROPIC_API_KEY',
	google: 'GOOGLE_GENERATIVE_AI_API_KEY',
	meta: 'META_MODEL_API_KEY',
	'ollama-cloud': 'OLLAMA_API_KEY',
	baseten: 'BASETEN_API_KEY',
	huggingface: 'HF_TOKEN',
	wafer: 'WAFER_API_KEY',
	openrouter: 'OPENROUTER_API_KEY',
	opencode: 'OPENCODE_API_KEY',
	copilot: 'GITHUB_TOKEN',
	ottorouter: 'OTTOROUTER_OAUTH',
	xai: 'XAI_API_KEY',
	zai: 'ZAI_API_KEY',
	'zai-coding': 'ZAI_CODING_API_KEY',
	deepseek: 'DEEPSEEK_API_KEY',
	kimi: 'KIMI_API_KEY',
	minimax: 'MINIMAX_API_KEY',
};

export function providerEnvVar(provider: ProviderId): string | undefined {
	return ENV_VARS[provider as BuiltInProviderId];
}

export function readEnvKey(provider: ProviderId): string | undefined {
	if (provider === 'ottorouter') {
		return undefined;
	}
	if (provider === 'kimi') {
		const value = readKimiApiKeyFromEnv();
		return value.length ? value : undefined;
	}
	if (provider === 'huggingface') {
		const value = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_API_KEY;
		return value?.length ? value : undefined;
	}
	if (!(provider in ENV_VARS) && provider !== 'copilot') {
		return undefined;
	}
	if (provider === 'copilot') {
		const copilotToken =
			process.env.COPILOT_GITHUB_TOKEN ??
			process.env.GH_TOKEN ??
			process.env.GITHUB_TOKEN;
		return copilotToken?.length ? copilotToken : undefined;
	}

	const key = providerEnvVar(provider);
	if (!key) return undefined;
	const value = process.env[key];
	return value?.length ? value : undefined;
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
