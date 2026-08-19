import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	BUILT_IN_PROVIDER_DESCRIPTORS,
	builtInProviderIds,
	catalog,
	getConfiguredProviderIds,
	getConfiguredProviderApiKey,
	getProviderDefinition,
	hasConfiguredProvider,
	loadGlobalConfig,
	providerEnvVar,
	readEnvKey,
} from '@ottocode/sdk';
import { createBuiltInProviderModel } from '../packages/sdk/src/providers/src/model-factory.ts';

const runtimeCases = [
	['openai', 'gpt-4o', 'openai.responses'],
	['anthropic', 'claude-3-5-sonnet-latest', 'anthropic.messages'],
	['google', 'gemini-2.0-flash', 'google.generative-ai'],
	['meta', 'muse-spark-1.1', 'openai.chat'],
	['ollama-cloud', 'qwen', 'ollama'],
	['baseten', 'test-model', 'baseten.chat'],
	['huggingface', 'test-model', 'huggingface.responses'],
	['wafer', 'test-model', 'Wafer.chat'],
	['openrouter', 'test-model', 'openrouter'],
	['opencode', 'gpt-5', 'openai.responses'],
	['zai', 'glm-4', 'Z.AI.chat'],
	['zai-coding', 'glm-4', 'Z.AI Coding Plan.chat'],
	['deepseek', 'deepseek-chat', 'DeepSeek.chat'],
	['minimax', 'MiniMax-M2.5', 'anthropic.messages'],
] as const;

describe('built-in provider descriptors', () => {
	let configHome: string;
	let previousConfigHome: string | undefined;
	let previousOttoHome: string | undefined;

	beforeEach(async () => {
		configHome = await mkdtemp(join(tmpdir(), 'otto-provider-descriptors-'));
		previousConfigHome = process.env.XDG_CONFIG_HOME;
		previousOttoHome = process.env.OTTO_HOME;
		process.env.XDG_CONFIG_HOME = configHome;
		process.env.OTTO_HOME = join(configHome, 'state');
	});

	afterEach(async () => {
		if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = previousConfigHome;
		if (previousOttoHome === undefined) delete process.env.OTTO_HOME;
		else process.env.OTTO_HOME = previousOttoHome;
		await rm(configHome, { recursive: true, force: true });
	});

	test('is exhaustive with the built-in catalog and self-consistent identities', () => {
		expect([...builtInProviderIds].sort()).toEqual(Object.keys(catalog).sort());
		for (const [id, descriptor] of Object.entries(
			BUILT_IN_PROVIDER_DESCRIPTORS,
		)) {
			expect(descriptor.id).toBe(id);
			expect(descriptor.environment.primary.length).toBeGreaterThan(0);
			expect(descriptor.runtimeKind.length).toBeGreaterThan(0);
		}
	});

	test('drives default configuration and registry policy', async () => {
		const config = await loadGlobalConfig();
		for (const descriptor of Object.values(BUILT_IN_PROVIDER_DESCRIPTORS)) {
			expect(config.providers[descriptor.id]?.enabled).toBe(
				descriptor.defaultEnabled,
			);
			const definition = getProviderDefinition(config, descriptor.id);
			expect(definition).toMatchObject({
				id: descriptor.id,
				source: 'built-in',
				compatibility: descriptor.compatibility,
				family: descriptor.promptFamily,
				allowAnyModel: descriptor.allowAnyModel,
			});
			expect(definition?.baseURL).toBe(descriptor.defaultBaseURL);
			expect(providerEnvVar(descriptor.id)).toBe(
				descriptor.environment.primary,
			);
		}
		expect(config.providers['ollama-cloud']?.baseURL).toBe(
			BUILT_IN_PROVIDER_DESCRIPTORS['ollama-cloud'].defaultBaseURL,
		);
	});

	test('reads declared environment aliases without changing primary names', async () => {
		const previousHfToken = process.env.HF_TOKEN;
		const previousHuggingFaceKey = process.env.HUGGINGFACE_API_KEY;
		const previousGithubToken = process.env.GITHUB_TOKEN;
		const previousCopilotToken = process.env.COPILOT_GITHUB_TOKEN;
		const previousGoogleKey = process.env.GOOGLE_API_KEY;
		const previousGoogleGenerativeKey =
			process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		try {
			delete process.env.HF_TOKEN;
			process.env.HUGGINGFACE_API_KEY = 'hf-alias';
			expect(readEnvKey('huggingface')).toBe('hf-alias');
			expect(providerEnvVar('huggingface')).toBe('HF_TOKEN');

			process.env.GITHUB_TOKEN = 'github-primary';
			process.env.COPILOT_GITHUB_TOKEN = 'copilot-alias';
			expect(readEnvKey('copilot')).toBe('copilot-alias');
			expect(providerEnvVar('copilot')).toBe('GITHUB_TOKEN');

			delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
			process.env.GOOGLE_API_KEY = 'google-alias';
			const config = await loadGlobalConfig();
			expect(getConfiguredProviderApiKey(config, 'google')).toBe(
				'google-alias',
			);
		} finally {
			if (previousHfToken === undefined) delete process.env.HF_TOKEN;
			else process.env.HF_TOKEN = previousHfToken;
			if (previousHuggingFaceKey === undefined)
				delete process.env.HUGGINGFACE_API_KEY;
			else process.env.HUGGINGFACE_API_KEY = previousHuggingFaceKey;
			if (previousGithubToken === undefined) delete process.env.GITHUB_TOKEN;
			else process.env.GITHUB_TOKEN = previousGithubToken;
			if (previousCopilotToken === undefined)
				delete process.env.COPILOT_GITHUB_TOKEN;
			else process.env.COPILOT_GITHUB_TOKEN = previousCopilotToken;
			if (previousGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
			else process.env.GOOGLE_API_KEY = previousGoogleKey;
			if (previousGoogleGenerativeKey === undefined)
				delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
			else
				process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousGoogleGenerativeKey;
		}
	});

	test('makes custom-provider opt-in and fallback policy explicit', async () => {
		const config = await loadGlobalConfig();
		config.providers['implicit-custom'] = {
			enabled: true,
			baseURL: 'https://example.test/v1',
		};
		expect(getProviderDefinition(config, 'implicit-custom')).toBeUndefined();

		config.providers['explicit-custom'] = {
			custom: true,
			enabled: false,
			baseURL: 'https://example.test/v1',
		};
		expect(getProviderDefinition(config, 'explicit-custom')).toMatchObject({
			source: 'custom',
			compatibility: 'openai-compatible',
			family: 'default',
			allowAnyModel: true,
		});
		expect(hasConfiguredProvider(config, 'explicit-custom')).toBe(false);
		expect(getConfiguredProviderIds(config)).not.toContain('explicit-custom');
		expect(
			getConfiguredProviderIds(config, { includeDisabled: true }),
		).toContain('explicit-custom');
	});
});

describe('built-in provider model factory', () => {
	for (const [provider, model, expectedRuntimeProvider] of runtimeCases) {
		test(`constructs ${provider} models through its descriptor runtime`, () => {
			const resolved = createBuiltInProviderModel(provider, model, {
				apiKey: 'test-key',
			});
			expect(resolved.provider).toBe(expectedRuntimeProvider);
			expect(resolved.modelId).toBe(model);
		});
	}

	for (const provider of ['copilot', 'ottorouter', 'xai', 'kimi'] as const) {
		test(`keeps ${provider} in a specialized runtime adapter`, () => {
			expect(() =>
				createBuiltInProviderModel(provider, 'test-model', {
					apiKey: 'test-key',
				}),
			).toThrow(
				`Provider ${provider} requires its specialized runtime adapter.`,
			);
		});
	}
});
