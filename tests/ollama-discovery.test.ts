import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	discoverOllamaModels,
	normalizeOllamaBaseURL,
	getProviderDefinition,
	writeCachedModelCatalog,
	type OttoConfig,
} from '@ottocode/sdk';

describe('ollama discovery', () => {
	test('normalizes common ollama endpoint shapes to a canonical base URL', () => {
		expect(normalizeOllamaBaseURL('http://127.0.0.1:11434/api')).toBe(
			'http://127.0.0.1:11434',
		);
		expect(normalizeOllamaBaseURL('https://example.com/ollama/api/chat')).toBe(
			'https://example.com/ollama',
		);
		expect(normalizeOllamaBaseURL('https://example.com/ollama/api/show')).toBe(
			'https://example.com/ollama',
		);
	});

	test('discovers model capabilities from tags and show endpoints', async () => {
		const calls: string[] = [];
		const fetchMock: typeof fetch = (async (input, init) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/api/tags')) {
				return new Response(
					JSON.stringify({
						models: [{ name: 'gemma4:latest' }, { name: 'qwen2.5-coder:14b' }],
					}),
				);
			}
			if (url.endsWith('/api/show')) {
				const body = JSON.parse(String(init?.body ?? '{}')) as {
					model: string;
				};
				if (body.model === 'gemma4:latest') {
					return new Response(
						JSON.stringify({
							capabilities: [
								'completion',
								'vision',
								'audio',
								'tools',
								'thinking',
							],
							details: {
								parameter_size: '9.6 GB',
								quantization_level: 'Q4_K_M',
							},
							model_info: {
								'gemma4.context_length': 131072,
							},
						}),
					);
				}
				return new Response(
					JSON.stringify({
						capabilities: ['completion', 'tools'],
						model_info: {
							'qwen.context_length': 65536,
						},
					}),
				);
			}
			return new Response('not found', { status: 404 });
		}) as typeof fetch;

		const result = await discoverOllamaModels({
			baseURL: 'https://example.com/ollama/api',
			fetch: fetchMock,
		});

		expect(result.baseURL).toBe('https://example.com/ollama');
		expect(calls).toEqual([
			'https://example.com/ollama/api/tags',
			'https://example.com/ollama/api/show',
			'https://example.com/ollama/api/show',
		]);
		expect(result.models).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'gemma4:latest',
					toolCall: true,
					reasoningText: true,
					limit: { context: 131072 },
					modalities: {
						input: ['text', 'image', 'audio'],
						output: ['text'],
					},
				}),
				expect.objectContaining({
					id: 'qwen2.5-coder:14b',
					toolCall: true,
					reasoningText: false,
					limit: { context: 65536 },
				}),
			]),
		);
	});

	test('normalizes custom model objects from cache', async () => {
		const configHome = await mkdtemp(join(tmpdir(), 'otto-ollama-cache-'));
		const previousConfigHome = process.env.XDG_CONFIG_HOME;

		try {
			process.env.XDG_CONFIG_HOME = configHome;
			await writeCachedModelCatalog({
				ollama: {
					id: 'ollama',
					label: 'Ollama',
					models: {
						'gemma4:latest': {
							id: 'gemma4:latest',
							label: 'Gemma 4',
							toolCall: true,
							reasoningText: true,
							modalities: { input: ['text', 'image'], output: ['text'] },
						},
					},
				},
			});

			const stateDir = join(tmpdir(), 'otto-home', 'projects', 'ollama-test');

			const cfg: OttoConfig = {
				projectRoot: process.cwd(),
				defaults: {
					agent: 'build',
					provider: 'ollama',
					model: 'gemma4:latest',
					toolApproval: 'auto',
					guidedMode: false,
					reasoningText: true,
					reasoningLevel: 'high',
					fullWidthContent: true,
					autoCompactThresholdTokens: null,
				},
				providers: {
					ollama: {
						enabled: true,
						custom: true,
						compatibility: 'ollama',
						family: 'default',
						baseURL: 'https://example.com/ollama',
					},
				},
				paths: {
					projectConfigDir: '.otto',
					projectConfigPath: '.otto/config.json',
					projectStateDir: stateDir,
					dataDir: stateDir,
					dbPath: join(stateDir, 'otto.sqlite'),
					attachmentsDir: join(stateDir, 'attachments'),
					debugDir: join(stateDir, 'debug'),
					debugDumpsDir: join(stateDir, 'debug-dumps'),
					logsDir: join(stateDir, 'logs'),
					tmpDir: join(stateDir, 'tmp'),
					cacheDir: join(stateDir, 'cache'),
					globalConfigPath: null,
				},
			};

			const definition = getProviderDefinition(cfg, 'ollama');
			expect(definition?.models).toEqual({
				'gemma4:latest': expect.objectContaining({
					id: 'gemma4:latest',
					label: 'Gemma 4',
					toolCall: true,
					reasoningText: true,
				}),
			});
		} finally {
			if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
			else process.env.XDG_CONFIG_HOME = previousConfigHome;
			await rm(configHome, { recursive: true, force: true });
		}
	});
});
