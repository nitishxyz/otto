import { describe, it, expect } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	providerBasePrompt,
	getModelFamily,
	getUnderlyingProviderKey,
	catalog,
} from '@ottocode/sdk';

describe('provider base prompts', () => {
	it('falls back to default when provider file missing', async () => {
		const result = await providerBasePrompt(
			'unknown-provider',
			undefined,
			process.cwd(),
		);
		expect(result.prompt.length).toBeGreaterThan(0);
		expect(result.resolvedType).toBe('default');
	});

	it('supports default prompt family for custom providers', async () => {
		const result = await providerBasePrompt(
			'my-ollama',
			'qwen2.5-coder:14b',
			process.cwd(),
			'default',
		);
		expect(result.prompt.length).toBeGreaterThan(0);
		expect(result.resolvedType).toBe('default');
	});

	it('loads project provider prompt overrides from .otto/prompts/providers', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-provider-prompt-'));
		try {
			const promptsDir = join(projectRoot, '.otto', 'prompts', 'providers');
			await mkdir(promptsDir, { recursive: true });
			await writeFile(join(promptsDir, 'openai.txt'), 'PROJECT OPENAI PROMPT');

			const result = await providerBasePrompt('openai', 'gpt-4o', projectRoot);
			expect(result.prompt).toBe('PROJECT OPENAI PROMPT');
			expect(result.resolvedType).toBe('custom:openai');
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	it('loads project model prompt overrides from .otto/prompts/models', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-model-prompt-'));
		try {
			const promptsDir = join(projectRoot, '.otto', 'prompts', 'models');
			await mkdir(promptsDir, { recursive: true });
			await writeFile(join(promptsDir, 'gpt-4o.txt'), 'PROJECT MODEL PROMPT');

			const result = await providerBasePrompt('openai', 'gpt-4o', projectRoot);
			expect(result.prompt).toBe('PROJECT MODEL PROMPT');
			expect(result.resolvedType).toBe('model:gpt-4o');
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	describe('direct provider prompt selection', () => {
		it('uses openai prompt for openai provider', async () => {
			const result = await providerBasePrompt(
				'openai',
				'gpt-4o',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('openai');
			expect(result.prompt).toContain('coding agent');
		});

		it('uses anthropic prompt for anthropic provider', async () => {
			const result = await providerBasePrompt(
				'anthropic',
				'claude-3-opus',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('anthropic');
			expect(result.prompt).toContain('Claude');
		});

		it('uses google prompt for google provider', async () => {
			const result = await providerBasePrompt(
				'google',
				'gemini-pro',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('google');
			expect(result.prompt).toContain('software engineering');
		});

		it('uses moonshot prompt for moonshot provider', async () => {
			const result = await providerBasePrompt(
				'moonshot',
				'kimi-k2.5',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('moonshot');
			expect(result.prompt).toContain('Kimi');
			expect(result.prompt).toContain('Thinking mode');
		});
	});

	describe('aggregate provider family detection (ottorouter)', () => {
		it('detects openai family for OttoRouter gpt models', async () => {
			const result = await providerBasePrompt(
				'ottorouter',
				'gpt-5-nano',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('openai');
			expect(result.prompt).toContain('coding agent');
		});

		it('detects anthropic family for OttoRouter claude models', async () => {
			const result = await providerBasePrompt(
				'ottorouter',
				'claude-3-5-haiku-latest',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('anthropic');
			expect(result.prompt).toContain('Claude');
		});

		it('detects moonshot family for OttoRouter kimi models', async () => {
			const result = await providerBasePrompt(
				'ottorouter',
				'kimi-k2.5',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('moonshot');
			expect(result.prompt).toContain('Kimi');
		});

		it('detects moonshot family for kimi-k2-thinking via OttoRouter', async () => {
			const result = await providerBasePrompt(
				'ottorouter',
				'kimi-k2-thinking',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('moonshot');
			expect(result.prompt).toContain('Thinking mode');
		});
	});

	describe('aggregate provider family detection (openrouter)', () => {
		it('detects openai family for openrouter gpt models', async () => {
			const result = await providerBasePrompt(
				'openrouter',
				'openai/gpt-4o',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('openai');
		});

		it('detects anthropic family for openrouter claude models', async () => {
			const result = await providerBasePrompt(
				'openrouter',
				'anthropic/claude-3-opus',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('anthropic');
		});

		it('detects moonshot family for openrouter kimi models', async () => {
			const result = await providerBasePrompt(
				'openrouter',
				'moonshotai/kimi-k2.5',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('moonshot');
		});

		it('detects google family for openrouter gemini models', async () => {
			const result = await providerBasePrompt(
				'openrouter',
				'google/gemini-pro',
				process.cwd(),
			);
			expect(result.resolvedType).toBe('google');
		});
	});

	describe('getModelFamily - ownedBy-based family detection', () => {
		it('returns direct provider mapping for known providers', () => {
			expect(getModelFamily('openai', 'gpt-4o')).toBe('openai');
			expect(getModelFamily('anthropic', 'claude-3-opus')).toBe('anthropic');
			expect(getModelFamily('google', 'gemini-pro')).toBe('google');
			expect(getModelFamily('moonshot', 'kimi-k2.5')).toBe('moonshot');
		});

		it('reads ownedBy from catalog for ottorouter models', () => {
			const ottorouterEntry = catalog.ottorouter;
			expect(ottorouterEntry).toBeDefined();

			const kimiModel = ottorouterEntry?.models.find((m) =>
				m.id.includes('kimi'),
			);
			if (kimiModel) {
				expect(kimiModel.ownedBy).toBe('moonshot');
				expect(getModelFamily('ottorouter', kimiModel.id)).toBe('moonshot');
			}

			const claudeModel = ottorouterEntry?.models.find((m) =>
				m.id.startsWith('claude'),
			);
			if (claudeModel) {
				expect(claudeModel.ownedBy).toBe('anthropic');
				expect(getModelFamily('ottorouter', claudeModel.id)).toBe('anthropic');
			}

			const gptModel = ottorouterEntry?.models.find(
				(m) => m.id.startsWith('gpt') || m.id.startsWith('codex'),
			);
			if (gptModel) {
				expect(gptModel.ownedBy).toBe('openai');
				expect(getModelFamily('ottorouter', gptModel.id)).toBe('openai');
			}

			const openrouterModel = ottorouterEntry?.models.find(
				(m) => m.id === 'healer-alpha',
			);
			if (openrouterModel) {
				expect(openrouterModel.ownedBy).toBe('openrouter');
				expect(openrouterModel.provider?.npm).toBe(
					'@openrouter/ai-sdk-provider',
				);
				expect(getModelFamily('ottorouter', openrouterModel.id)).toBe(
					'openai-compatible',
				);
			}
		});

		it('falls back to model ID inference for unknown models', () => {
			const family = getModelFamily('openrouter', 'openai/gpt-4o');
			expect(family).toBe('openai');
		});

		it('detects families from model ID patterns for openrouter', () => {
			expect(getModelFamily('openrouter', 'anthropic/claude-3-opus')).toBe(
				'anthropic',
			);
			expect(getModelFamily('openrouter', 'openai/gpt-4o')).toBe('openai');
			expect(getModelFamily('openrouter', 'google/gemini-pro')).toBe('google');
			expect(getModelFamily('openrouter', 'moonshotai/kimi-k2.5')).toBe(
				'moonshot',
			);
		});

		it('detects families from model name for opencode', () => {
			expect(getModelFamily('opencode', 'claude-3-opus')).toBe('anthropic');
			expect(getModelFamily('opencode', 'gpt-5')).toBe('openai');
			expect(getModelFamily('opencode', 'gemini-2-flash')).toBe('google');
			expect(getModelFamily('opencode', 'kimi-k2.5')).toBe('moonshot');
		});
	});

	describe('getUnderlyingProviderKey - ownedBy-based detection', () => {
		it('maps direct providers correctly', () => {
			expect(getUnderlyingProviderKey('anthropic', 'claude-3-opus')).toBe(
				'anthropic',
			);
			expect(getUnderlyingProviderKey('openai', 'gpt-4o')).toBe('openai');
			expect(getUnderlyingProviderKey('google', 'gemini-pro')).toBe('google');
			expect(getUnderlyingProviderKey('moonshot', 'kimi-k2')).toBe('moonshot');
		});

		it('maps ottorouter models via ownedBy', () => {
			expect(
				getUnderlyingProviderKey('ottorouter', 'claude-3-5-haiku-latest'),
			).toBe('anthropic');
			expect(getUnderlyingProviderKey('ottorouter', 'codex-mini-latest')).toBe(
				'openai',
			);
			expect(getUnderlyingProviderKey('ottorouter', 'kimi-k2.5')).toBe(
				'moonshot',
			);
			expect(getUnderlyingProviderKey('ottorouter', 'healer-alpha')).toBe(
				'openai-compatible',
			);
		});
	});

	describe('catalog ownedBy field is properly set', () => {
		it('ottorouter models have ownedBy field', () => {
			const ottorouterEntry = catalog.ottorouter;
			expect(ottorouterEntry).toBeDefined();
			expect(ottorouterEntry?.models.length).toBeGreaterThan(0);

			for (const model of ottorouterEntry?.models || []) {
				expect(model.ownedBy).toBeDefined();
				expect([
					'openai',
					'anthropic',
					'deepseek',
					'moonshot',
					'google',
					'minimax',
					'xai',
					'zai',
				]).toContain(model.ownedBy);
			}
		});

		it('single-provider models have ownedBy matching their provider', () => {
			const openaiEntry = catalog.openai;
			if (openaiEntry) {
				for (const model of openaiEntry.models.slice(0, 3)) {
					expect(model.ownedBy).toBe('openai');
				}
			}
			const anthropicEntry = catalog.anthropic;
			if (anthropicEntry) {
				for (const model of anthropicEntry.models.slice(0, 3)) {
					expect(model.ownedBy).toBe('anthropic');
				}
			}
		});

		it('moonshot provider models have correct npm binding', () => {
			const moonshotEntry = catalog.moonshot;
			expect(moonshotEntry).toBeDefined();
			expect(moonshotEntry?.npm).toBe('@ai-sdk/openai-compatible');

			for (const model of moonshotEntry?.models || []) {
				expect(model.id).toContain('kimi');
			}
		});
	});

	describe('prompt content verification', () => {
		it('provider prompts contain relevant provider-specific instructions', async () => {
			const openai = await providerBasePrompt(
				'openai',
				'gpt-4o',
				process.cwd(),
			);
			const google = await providerBasePrompt(
				'google',
				'gemini-pro',
				process.cwd(),
			);
			const moonshot = await providerBasePrompt(
				'moonshot',
				'kimi-k2.5',
				process.cwd(),
			);

			expect(openai.prompt.length).toBeGreaterThan(100);
			expect(google.prompt.length).toBeGreaterThan(100);
			expect(moonshot.prompt.length).toBeGreaterThan(100);
			expect(moonshot.prompt).toContain('Kimi');
		});

		it('anthropic prompt has conciseness examples in XML', async () => {
			const result = await providerBasePrompt(
				'anthropic',
				'claude-3-opus',
				process.cwd(),
			);
			expect(result.prompt).toContain('Claude');
			expect(result.prompt.length).toBeGreaterThan(100);
		});

		it('default prompt has communication style', async () => {
			const result = await providerBasePrompt(
				'unknown-provider',
				undefined,
				process.cwd(),
			);
			expect(result.prompt).toContain('coding agent');
			expect(result.prompt.length).toBeGreaterThan(100);
		});

		it('all provider prompts are present and non-trivial', async () => {
			const providers = [
				{ provider: 'openai', model: 'gpt-4o' },
				{ provider: 'anthropic', model: 'claude-3-opus' },
				{ provider: 'google', model: 'gemini-pro' },
				{ provider: 'moonshot', model: 'kimi-k2.5' },
			];
			for (const { provider, model } of providers) {
				const result = await providerBasePrompt(provider, model, process.cwd());
				expect(result.prompt.length).toBeGreaterThan(50);
				expect(typeof result.resolvedType).toBe('string');
			}
		});
	});
});
