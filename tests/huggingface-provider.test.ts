import { afterEach, describe, expect, test } from 'bun:test';
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import {
	catalog,
	getFastModel,
	getProviderDefinition,
	providerEnvVar,
	resolveModel,
	validateProviderModel,
	type OttoConfig,
} from '@ottocode/sdk';
import { createEmbeddedApp } from '../packages/server/src/index.js';

const HUGGINGFACE_BASE_URL = 'https://router.huggingface.co/v1';
const HUGGINGFACE_FAST_MODEL = 'deepseek-ai/DeepSeek-V4-Flash:deepinfra';

function createConfig(): OttoConfig {
	return {
		projectRoot: process.cwd(),
		defaults: {
			agent: 'build',
			provider: 'huggingface',
			model: HUGGINGFACE_FAST_MODEL,
			toolApproval: 'auto',
			guidedMode: false,
			reasoningText: true,
			reasoningLevel: 'high',
			fullWidthContent: true,
			autoCompactThresholdTokens: null,
		},
		providers: {
			huggingface: { enabled: true },
		},
		paths: {
			projectConfigDir: '.otto',
			projectConfigPath: '.otto/config.json',
			projectStateDir: '.otto',
			dataDir: '.otto',
			dbPath: '.otto/otto.sqlite',
			attachmentsDir: '.otto/attachments',
			debugDir: '.otto/debug',
			debugDumpsDir: '.otto/debug-dumps',
			logsDir: '.otto/logs',
			tmpDir: '.otto/tmp',
			cacheDir: '.otto/cache',
			globalConfigPath: null,
		},
	};
}

describe('Hugging Face provider', () => {
	const previousHfToken = process.env.HF_TOKEN;
	const previousHuggingFaceKey = process.env.HUGGINGFACE_API_KEY;

	afterEach(() => {
		if (previousHfToken === undefined) {
			delete process.env.HF_TOKEN;
		} else {
			process.env.HF_TOKEN = previousHfToken;
		}
		if (previousHuggingFaceKey === undefined) {
			delete process.env.HUGGINGFACE_API_KEY;
		} else {
			process.env.HUGGINGFACE_API_KEY = previousHuggingFaceKey;
		}
	});

	test('uses Hugging Face token environment variable', () => {
		expect(providerEnvVar('huggingface')).toBe('HF_TOKEN');
		expect(catalog.huggingface.env).toEqual([
			'HF_TOKEN',
			'HUGGINGFACE_API_KEY',
		]);
	});

	test('resolves as an OpenAI-compatible router provider', () => {
		const definition = getProviderDefinition(createConfig(), 'huggingface');

		expect(definition).toMatchObject({
			id: 'huggingface',
			label: 'Hugging Face',
			source: 'built-in',
			compatibility: 'openai-compatible',
			family: 'openai-compatible',
			baseURL: HUGGINGFACE_BASE_URL,
			apiKeyEnv: 'HF_TOKEN',
			allowAnyModel: true,
		});
		expect(getFastModel('huggingface')).toBe(HUGGINGFACE_FAST_MODEL);
	});

	test('contains curated Hugging Face router models', () => {
		const models = new Set(Object.keys(catalog.huggingface.models));

		for (const model of [
			'zai-org/GLM-5.2:together',
			'moonshotai/Kimi-K2.7-Code:together',
			HUGGINGFACE_FAST_MODEL,
			'Qwen/Qwen3-Coder-480B-A35B-Instruct:novita',
		]) {
			expect(models.has(model)).toBe(true);
			expect(() =>
				validateProviderModel('huggingface', model, createConfig()),
			).not.toThrow();
		}
	});

	test('sends requests to the Hugging Face router with bearer auth', async () => {
		let capturedUrl: string | undefined;
		let capturedAuthorization: string | undefined;
		const fetchMock: typeof fetch = async (input, init) => {
			capturedUrl = String(input);
			const headers = new Headers(init?.headers);
			capturedAuthorization = headers.get('authorization') ?? undefined;
			return new Response(
				JSON.stringify({
					id: 'resp-test',
					model: HUGGINGFACE_FAST_MODEL,
					object: 'response',
					created_at: 1,
					status: 'completed',
					error: null,
					instructions: null,
					max_output_tokens: null,
					metadata: null,
					tool_choice: 'auto',
					tools: [],
					temperature: 1,
					top_p: 1,
					output: [
						{
							type: 'message',
							id: 'msg-test',
							content: [{ type: 'output_text', text: 'ok' }],
						},
					],
					usage: {
						input_tokens: 1,
						output_tokens: 1,
						total_tokens: 2,
					},
				}),
				{ headers: { 'content-type': 'application/json' } },
			);
		};
		const model = await resolveModel('huggingface', HUGGINGFACE_FAST_MODEL, {
			apiKey: 'hf-test-token',
			customFetch: fetchMock,
		});
		const options: LanguageModelV3CallOptions = {
			prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
		};

		await model.doGenerate(options);

		expect(capturedUrl).toBe(`${HUGGINGFACE_BASE_URL}/responses`);
		expect(capturedAuthorization).toBe('Bearer hf-test-token');
	});

	test('auth status reports API-key auth and no OAuth support', async () => {
		process.env.HF_TOKEN = 'hf-env-token';
		const app = createEmbeddedApp();
		const response = await app.request('http://localhost/v1/auth/status');
		const payload = (await response.json()) as {
			providers: Record<
				string,
				{ configured: boolean; type?: string; supportsOAuth: boolean }
			>;
		};

		expect(response.status).toBe(200);
		expect(payload.providers.huggingface).toMatchObject({
			configured: true,
			type: 'api',
			supportsOAuth: false,
		});
	});
});
