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

const BASETEN_BASE_URL = 'https://inference.baseten.co/v1';
const BASETEN_FAST_MODEL = 'nvidia/Nemotron-120B-A12B';

function createConfig(): OttoConfig {
	return {
		projectRoot: process.cwd(),
		defaults: {
			agent: 'build',
			provider: 'baseten',
			model: BASETEN_FAST_MODEL,
			toolApproval: 'auto',
			guidedMode: false,
			reasoningText: true,
			reasoningLevel: 'high',
			fullWidthContent: true,
			autoCompactThresholdTokens: null,
		},
		providers: {
			baseten: { enabled: true },
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

describe('Baseten provider', () => {
	const previousBasetenKey = process.env.BASETEN_API_KEY;

	afterEach(() => {
		if (previousBasetenKey === undefined) {
			delete process.env.BASETEN_API_KEY;
		} else {
			process.env.BASETEN_API_KEY = previousBasetenKey;
		}
	});

	test('uses Baseten API-key environment variable', () => {
		expect(providerEnvVar('baseten')).toBe('BASETEN_API_KEY');
		expect(catalog.baseten.env).toEqual(['BASETEN_API_KEY']);
	});

	test('resolves as an OpenAI-compatible provider', () => {
		const definition = getProviderDefinition(createConfig(), 'baseten');

		expect(definition).toMatchObject({
			id: 'baseten',
			label: 'Baseten',
			source: 'built-in',
			compatibility: 'openai-compatible',
			family: 'openai-compatible',
			baseURL: BASETEN_BASE_URL,
			apiKeyEnv: 'BASETEN_API_KEY',
			allowAnyModel: true,
		});
		expect(getFastModel('baseten')).toBe(BASETEN_FAST_MODEL);
	});

	test('contains curated Baseten model API models', () => {
		const models = new Set(Object.keys(catalog.baseten.models));

		for (const model of [
			BASETEN_FAST_MODEL,
			'moonshotai/Kimi-K2-Instruct-0905',
			'Qwen/Qwen3-Coder-480B-A35B-Instruct',
		]) {
			expect(models.has(model)).toBe(true);
			expect(() =>
				validateProviderModel('baseten', model, createConfig()),
			).not.toThrow();
		}
	});

	test('sends requests to Baseten with bearer auth', async () => {
		let capturedUrl: string | undefined;
		let capturedAuthorization: string | undefined;
		const fetchMock: typeof fetch = async (input, init) => {
			capturedUrl = String(input);
			const headers = new Headers(init?.headers);
			capturedAuthorization = headers.get('authorization') ?? undefined;
			return new Response(
				JSON.stringify({
					id: 'chatcmpl-test',
					model: BASETEN_FAST_MODEL,
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
		const model = await resolveModel('baseten', BASETEN_FAST_MODEL, {
			apiKey: 'baseten-test-key',
			customFetch: fetchMock,
		});
		const options: LanguageModelV3CallOptions = {
			prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
		};

		await model.doGenerate(options);

		expect(capturedUrl).toBe(`${BASETEN_BASE_URL}/chat/completions`);
		expect(capturedAuthorization).toBe('Bearer baseten-test-key');
	});

	test('auth status reports API-key auth and no OAuth support', async () => {
		process.env.BASETEN_API_KEY = 'baseten-env-key';
		const app = createEmbeddedApp();
		const response = await app.request(
			`http://localhost/v1/auth/status?project=${encodeURIComponent(process.cwd())}`,
		);
		const payload = (await response.json()) as {
			providers: Record<
				string,
				{ configured: boolean; type?: string; supportsOAuth: boolean }
			>;
		};

		expect(response.status).toBe(200);
		expect(payload.providers.baseten).toMatchObject({
			configured: true,
			type: 'api',
			supportsOAuth: false,
		});
	});
});
