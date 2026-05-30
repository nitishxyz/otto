import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { OttoConfig } from '@ottocode/sdk';
import {
	getProviderDefinition,
	readCachedModelCatalog,
	validateProviderModel,
	writeCachedModelCatalog,
} from '@ottocode/sdk';
import { createEmbeddedApp } from '../packages/server/src/index.js';
import { selectProviderAndModel } from '../packages/server/src/runtime/provider/selection.ts';
import { buildReasoningConfig } from '../packages/server/src/runtime/provider/reasoning.ts';

function createConfig(): OttoConfig {
	return {
		projectRoot: process.cwd(),
		defaults: {
			agent: 'build',
			provider: 'my-ollama',
			model: 'qwen2.5-coder:14b',
			toolApproval: 'auto',
			guidedMode: false,
			reasoningText: true,
			reasoningLevel: 'high',
			fullWidthContent: true,
			autoCompactThresholdTokens: null,
		},
		providers: {
			openai: { enabled: false },
			anthropic: { enabled: false },
			google: { enabled: false },
			openrouter: { enabled: false },
			opencode: { enabled: false },
			copilot: { enabled: false },
			ottorouter: { enabled: false },
			zai: { enabled: false },
			'zai-coding': { enabled: false },
			moonshot: { enabled: false },
			minimax: { enabled: false },
			'my-ollama': {
				enabled: true,
				custom: true,
				label: 'Local Ollama',
				compatibility: 'ollama',
				family: 'default',
				baseURL: 'http://127.0.0.1:11434/api',
				models: ['qwen2.5-coder:14b', 'deepseek-r1:32b'],
			},
		},
		paths: {
			dataDir: '.otto',
			dbPath: '.otto/otto.sqlite',
			projectConfigPath: '.otto/config.json',
			globalConfigPath: null,
		},
	};
}

describe('custom declarative providers', () => {
	test('builds a runtime definition for configured custom providers', () => {
		const cfg = createConfig();
		const definition = getProviderDefinition(cfg, 'my-ollama');

		expect(definition).toMatchObject({
			id: 'my-ollama',
			label: 'Local Ollama',
			source: 'custom',
			compatibility: 'ollama',
			family: 'default',
			baseURL: 'http://127.0.0.1:11434/api',
			allowAnyModel: false,
		});
		expect(definition?.models).toEqual([
			{ id: 'qwen2.5-coder:14b', label: 'qwen2.5-coder:14b' },
			{ id: 'deepseek-r1:32b', label: 'deepseek-r1:32b' },
		]);
	});

	test('validates cached custom provider models', async () => {
		const configHome = await mkdtemp(join(tmpdir(), 'otto-config-validate-'));
		const previousConfigHome = process.env.XDG_CONFIG_HOME;

		try {
			process.env.XDG_CONFIG_HOME = configHome;
			await writeCachedModelCatalog({
				'my-ollama': {
					id: 'my-ollama',
					label: 'Local Ollama',
					models: [{ id: 'cached-model', label: 'cached-model' }],
				},
			});
			const cfg = createConfig();

			expect(() =>
				validateProviderModel('my-ollama', 'cached-model', cfg),
			).not.toThrow();
			expect(() =>
				validateProviderModel('my-ollama', 'qwen2.5-coder:14b', cfg),
			).toThrow(/Model not found for provider my-ollama/);
		} finally {
			if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previousConfigHome;
			await rm(configHome, { recursive: true, force: true });
		}
	});

	test('selects configured custom provider defaults', async () => {
		const cfg = createConfig();
		const selection = await selectProviderAndModel({
			cfg,
			agentProviderDefault: 'my-ollama',
			agentModelDefault: 'qwen2.5-coder:14b',
		});

		expect(selection).toEqual({
			provider: 'my-ollama',
			model: 'qwen2.5-coder:14b',
			providerOverride: undefined,
			modelOverride: undefined,
		});
	});

	test('uses ollama reasoning options for custom providers', () => {
		const cfg = createConfig();
		const result = buildReasoningConfig({
			cfg,
			provider: 'my-ollama',
			model: 'qwen2.5-coder:14b',
			reasoningText: true,
			reasoningLevel: 'medium',
			maxOutputTokens: 4000,
		});

		expect(result.enabled).toBe(true);
		expect(result.providerOptions).toEqual({
			ollama: { think: true },
		});
	});

	test('persists custom providers through config routes', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-provider-route-'));
		const configHome = await mkdtemp(join(tmpdir(), 'otto-config-route-'));
		const previousConfigHome = process.env.XDG_CONFIG_HOME;

		try {
			process.env.XDG_CONFIG_HOME = configHome;
			const app = createEmbeddedApp();
			const putResponse = await app.request(
				`http://localhost/v1/config/providers/my-ollama?project=${encodeURIComponent(projectRoot)}`,
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						scope: 'local',
						custom: true,
						compatibility: 'ollama',
						family: 'default',
						label: 'Local Ollama',
						baseURL: 'http://127.0.0.1:11434/api',
						models: ['qwen2.5-coder:14b'],
					}),
				},
			);

			expect(putResponse.status).toBe(200);

			const providersResponse = await app.request(
				`http://localhost/v1/config/providers?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(providersResponse.status).toBe(200);
			const providersPayload = (await providersResponse.json()) as {
				providers: string[];
				details: Array<{ id: string; custom: boolean; compatibility?: string }>;
			};
			expect(providersPayload.details).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: 'my-ollama',
						custom: true,
						compatibility: 'ollama',
					}),
				]),
			);

			const modelsResponse = await app.request(
				`http://localhost/v1/config/providers/my-ollama/models?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(modelsResponse.status).toBe(200);
			const modelsPayload = (await modelsResponse.json()) as {
				models: Array<{ id: string }>;
				allowAnyModel: boolean;
			};
			expect(modelsPayload.allowAnyModel).toBe(false);
			expect(modelsPayload.models.map((model) => model.id)).toEqual([
				'qwen2.5-coder:14b',
			]);

			const allModelsResponse = await app.request(
				`http://localhost/v1/config/models?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(allModelsResponse.status).toBe(200);
			const allModelsPayload = (await allModelsResponse.json()) as Record<
				string,
				{ models: Array<{ id: string }> }
			>;
			expect(
				allModelsPayload['my-ollama'].models.map((model) => model.id),
			).toEqual(['qwen2.5-coder:14b']);
		} finally {
			if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previousConfigHome;
			await rm(projectRoot, { recursive: true, force: true });
			await rm(configHome, { recursive: true, force: true });
		}
	});

	test('uses cached catalog models instead of configured custom models', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-provider-cache-'));
		const configHome = await mkdtemp(join(tmpdir(), 'otto-config-cache-'));
		const previousConfigHome = process.env.XDG_CONFIG_HOME;

		try {
			process.env.XDG_CONFIG_HOME = configHome;
			const app = createEmbeddedApp();
			await writeCachedModelCatalog({
				'my-ollama': {
					id: 'my-ollama',
					label: 'Local Ollama',
					models: [{ id: 'cached-only', label: 'cached-only' }],
				},
			});

			const putResponse = await app.request(
				`http://localhost/v1/config/providers/my-ollama?project=${encodeURIComponent(projectRoot)}`,
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						scope: 'local',
						custom: true,
						compatibility: 'ollama',
						family: 'default',
						label: 'Local Ollama',
						baseURL: 'http://127.0.0.1:11434/api',
						models: ['configured-one', 'configured-two'],
					}),
				},
			);
			expect(putResponse.status).toBe(200);

			const modelsResponse = await app.request(
				`http://localhost/v1/config/providers/my-ollama/models?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(modelsResponse.status).toBe(200);
			const modelsPayload = (await modelsResponse.json()) as {
				models: Array<{ id: string }>;
			};
			expect(modelsPayload.models.map((model) => model.id)).toEqual([
				'cached-only',
			]);

			const allModelsResponse = await app.request(
				`http://localhost/v1/config/models?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(allModelsResponse.status).toBe(200);
			const allModelsPayload = (await allModelsResponse.json()) as Record<
				string,
				{ models: Array<{ id: string }> }
			>;
			expect(
				allModelsPayload['my-ollama'].models.map((model) => model.id),
			).toEqual(['cached-only']);
		} finally {
			if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previousConfigHome;
			await rm(projectRoot, { recursive: true, force: true });
			await rm(configHome, { recursive: true, force: true });
		}
	});

	test('does not expose cached provider models without provider auth', async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), 'otto-provider-cache-only-'),
		);
		const configHome = await mkdtemp(join(tmpdir(), 'otto-config-cache-only-'));
		const previousConfigHome = process.env.XDG_CONFIG_HOME;

		try {
			process.env.XDG_CONFIG_HOME = configHome;
			const app = createEmbeddedApp();
			await writeCachedModelCatalog({
				ollama: {
					id: 'ollama',
					label: 'Ollama',
					models: [{ id: 'gemma4:latest', label: 'gemma4:latest' }],
				},
			});

			const allModelsResponse = await app.request(
				`http://localhost/v1/config/models?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(allModelsResponse.status).toBe(200);
			const allModelsPayload = (await allModelsResponse.json()) as Record<
				string,
				{ models: Array<{ id: string }> }
			>;
			expect(allModelsPayload.ollama).toBeUndefined();

			const modelsResponse = await app.request(
				`http://localhost/v1/config/providers/ollama/models?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(modelsResponse.status).toBe(403);
		} finally {
			if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previousConfigHome;
			await rm(projectRoot, { recursive: true, force: true });
			await rm(configHome, { recursive: true, force: true });
		}
	});

	test('reads catalog-models cache as model catalog source', async () => {
		const configHome = await mkdtemp(
			join(tmpdir(), 'otto-config-catalog-cache-'),
		);
		const previousConfigHome = process.env.XDG_CONFIG_HOME;

		try {
			process.env.XDG_CONFIG_HOME = configHome;
			const configDir = join(configHome, 'otto');
			await mkdir(configDir, { recursive: true });
			await writeFile(
				join(configDir, 'catalog-models.json'),
				JSON.stringify({
					version: 1,
					updatedAt: new Date().toISOString(),
					providers: {
						'my-ollama': {
							id: 'my-ollama',
							label: 'Local Ollama',
							models: [{ id: 'catalog-cached', label: 'catalog-cached' }],
						},
					},
				}),
			);

			const catalog = await readCachedModelCatalog();
			expect(catalog?.providers['my-ollama']?.models[0]?.id).toBe(
				'catalog-cached',
			);
		} finally {
			if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previousConfigHome;
			await rm(configHome, { recursive: true, force: true });
		}
	});

	test('shows env-authorized built-in providers even when local provider toggles are false', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-provider-auth-'));
		const app = createEmbeddedApp();
		const previousOpenAI = process.env.OPENAI_API_KEY;
		const previousAnthropic = process.env.ANTHROPIC_API_KEY;

		try {
			process.env.OPENAI_API_KEY = 'test-openai-key';
			process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

			const providersResponse = await app.request(
				`http://localhost/v1/config/providers?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(providersResponse.status).toBe(200);
			const providersPayload = (await providersResponse.json()) as {
				providers: string[];
			};
			expect(providersPayload.providers).toContain('openai');
			expect(providersPayload.providers).toContain('anthropic');
		} finally {
			if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY;
			else process.env.OPENAI_API_KEY = previousOpenAI;
			if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
			else process.env.ANTHROPIC_API_KEY = previousAnthropic;
			await rm(projectRoot, { recursive: true, force: true });
		}
	});
});
