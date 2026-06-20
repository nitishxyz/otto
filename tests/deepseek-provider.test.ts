import { afterEach, describe, expect, test } from 'bun:test';
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import {
	catalog,
	createDeepSeekModel,
	getFastModel,
	getProviderDefinition,
	modelMapToList,
	providerEnvVar,
	validateProviderModel,
	type OttoConfig,
} from '@ottocode/sdk';
import { createEmbeddedApp } from '../packages/server/src/index.js';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

function createConfig(): OttoConfig {
	return {
		projectRoot: process.cwd(),
		defaults: {
			agent: 'build',
			provider: 'deepseek',
			model: 'deepseek-v4-flash',
			toolApproval: 'auto',
			guidedMode: false,
			reasoningText: true,
			reasoningLevel: 'high',
			fullWidthContent: true,
			autoCompactThresholdTokens: null,
		},
		providers: {
			deepseek: { enabled: true },
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

describe('DeepSeek provider', () => {
	const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;

	afterEach(() => {
		if (previousDeepSeekKey === undefined) {
			delete process.env.DEEPSEEK_API_KEY;
		} else {
			process.env.DEEPSEEK_API_KEY = previousDeepSeekKey;
		}
	});

	test('uses DeepSeek API-key environment variable', () => {
		expect(providerEnvVar('deepseek')).toBe('DEEPSEEK_API_KEY');
		expect(catalog.deepseek.env).toEqual(['DEEPSEEK_API_KEY']);
	});

	test('resolves as an OpenAI-compatible provider', () => {
		const definition = getProviderDefinition(createConfig(), 'deepseek');

		expect(definition).toMatchObject({
			id: 'deepseek',
			label: 'DeepSeek',
			source: 'built-in',
			compatibility: 'openai-compatible',
			family: 'openai-compatible',
			baseURL: DEEPSEEK_BASE_URL,
			apiKeyEnv: 'DEEPSEEK_API_KEY',
		});
		expect(modelMapToList(definition?.models ?? {})[0]?.id).toBe(
			'deepseek-v4-flash',
		);
		expect(getFastModel('deepseek')).toBe('deepseek-v4-flash');
	});

	test('contains documented DeepSeek API models', () => {
		const models = new Set(Object.keys(catalog.deepseek.models));

		for (const model of [
			'deepseek-v4-flash',
			'deepseek-v4-pro',
			'deepseek-chat',
			'deepseek-reasoner',
		]) {
			expect(models.has(model)).toBe(true);
			expect(() =>
				validateProviderModel('deepseek', model, createConfig()),
			).not.toThrow();
		}
	});

	test('sends requests to DeepSeek with bearer API-key auth', async () => {
		let capturedUrl: string | undefined;
		let capturedAuthorization: string | undefined;
		const fetchMock: typeof fetch = async (input, init) => {
			capturedUrl = String(input);
			const headers = new Headers(init?.headers);
			capturedAuthorization = headers.get('authorization') ?? undefined;
			return new Response(
				JSON.stringify({
					id: 'chatcmpl-test',
					model: 'deepseek-v4-flash',
					choices: [
						{
							message: { role: 'assistant', content: 'ok' },
							finish_reason: 'stop',
						},
					],
					usage: { prompt_tokens: 1, completion_tokens: 1 },
				}),
				{ headers: { 'content-type': 'application/json' } },
			);
		};
		const model = createDeepSeekModel('deepseek-v4-flash', {
			apiKey: 'deepseek-test-key',
			fetch: fetchMock,
		});
		const options: LanguageModelV3CallOptions = {
			prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
		};

		await model.doGenerate(options);

		expect(capturedUrl).toBe(`${DEEPSEEK_BASE_URL}/chat/completions`);
		expect(capturedAuthorization).toBe('Bearer deepseek-test-key');
	});

	test('auth status reports API-key auth and no OAuth support', async () => {
		process.env.DEEPSEEK_API_KEY = 'deepseek-env-key';
		const app = createEmbeddedApp();
		const response = await app.request('http://localhost/v1/auth/status');
		const payload = (await response.json()) as {
			providers: Record<
				string,
				{ configured: boolean; type?: string; supportsOAuth: boolean }
			>;
		};

		expect(response.status).toBe(200);
		expect(payload.providers.deepseek).toMatchObject({
			configured: true,
			type: 'api',
			supportsOAuth: false,
		});
	});
});
