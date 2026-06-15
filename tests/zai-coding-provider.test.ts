import { afterEach, describe, expect, test } from 'bun:test';
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import {
	catalog,
	createZaiCodingModel,
	getProviderDefinition,
	providerEnvVar,
	validateProviderModel,
	type OttoConfig,
} from '@ottocode/sdk';
import { createEmbeddedApp } from '../packages/server/src/index.js';

const ZAI_CODING_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

function createConfig(): OttoConfig {
	return {
		projectRoot: process.cwd(),
		defaults: {
			agent: 'build',
			provider: 'zai-coding',
			model: 'glm-5.2',
			toolApproval: 'auto',
			guidedMode: false,
			reasoningText: true,
			reasoningLevel: 'high',
			fullWidthContent: true,
			autoCompactThresholdTokens: null,
		},
		providers: {
			'zai-coding': { enabled: true },
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

describe('Z.AI Coding Plan provider', () => {
	const previousZaiCodingKey = process.env.ZAI_CODING_API_KEY;

	afterEach(() => {
		if (previousZaiCodingKey === undefined) {
			delete process.env.ZAI_CODING_API_KEY;
		} else {
			process.env.ZAI_CODING_API_KEY = previousZaiCodingKey;
		}
	});

	test('uses a dedicated API-key environment variable', () => {
		expect(providerEnvVar('zai-coding')).toBe('ZAI_CODING_API_KEY');
		expect(catalog['zai-coding'].env).toEqual(['ZAI_CODING_API_KEY']);
	});

	test('resolves as an OpenAI-compatible GLM coding provider', () => {
		const definition = getProviderDefinition(createConfig(), 'zai-coding');

		expect(definition).toMatchObject({
			id: 'zai-coding',
			label: 'Z.AI Coding Plan',
			source: 'built-in',
			compatibility: 'openai-compatible',
			family: 'glm',
			baseURL: ZAI_CODING_BASE_URL,
			apiKeyEnv: 'ZAI_CODING_API_KEY',
		});
		expect(definition?.models[0]?.id).toBe('glm-5.2');
	});

	test('contains documented GLM Coding Plan models', () => {
		const models = new Set(
			catalog['zai-coding'].models.map((model) => model.id),
		);

		for (const model of [
			'glm-5.2',
			'glm-5.1',
			'glm-5',
			'glm-5-turbo',
			'glm-4.7',
			'glm-4.5-air',
			'glm-5v-turbo',
		]) {
			expect(models.has(model)).toBe(true);
			expect(() =>
				validateProviderModel('zai-coding', model, createConfig()),
			).not.toThrow();
		}
	});

	test('sends requests to the coding endpoint with bearer API-key auth', async () => {
		let capturedUrl: string | undefined;
		let capturedAuthorization: string | undefined;
		const fetchMock: typeof fetch = async (input, init) => {
			capturedUrl = String(input);
			const headers = new Headers(init?.headers);
			capturedAuthorization = headers.get('authorization') ?? undefined;
			return new Response(
				JSON.stringify({
					id: 'chatcmpl-test',
					model: 'glm-5.2',
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
		const model = createZaiCodingModel('glm-5.2', {
			apiKey: 'zai-test-key',
			fetch: fetchMock,
		});
		const options: LanguageModelV3CallOptions = {
			prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
		};

		await model.doGenerate(options);

		expect(capturedUrl).toBe(`${ZAI_CODING_BASE_URL}/chat/completions`);
		expect(capturedAuthorization).toBe('Bearer zai-test-key');
	});

	test('auth status reports API-key auth and no OAuth support', async () => {
		process.env.ZAI_CODING_API_KEY = 'zai-env-key';
		const app = createEmbeddedApp();
		const response = await app.request('http://localhost/v1/auth/status');
		const payload = (await response.json()) as {
			providers: Record<
				string,
				{ configured: boolean; type?: string; supportsOAuth: boolean }
			>;
		};

		expect(response.status).toBe(200);
		expect(payload.providers['zai-coding']).toMatchObject({
			configured: true,
			type: 'api',
			supportsOAuth: false,
		});
	});
});
