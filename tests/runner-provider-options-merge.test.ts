import { describe, expect, test } from 'bun:test';
import {
	applyModelFamilyEditToolPolicy,
	mergeProviderOptions,
} from '../packages/server/src/runtime/agent/runner-setup.ts';
import { buildCodexProviderOptions } from '../packages/server/src/runtime/provider/oauth-adapter.ts';
import type { OttoConfig } from '../packages/sdk/src/types/src/config.ts';

const editPolicyTools = [
	'read',
	'edit',
	'multiedit',
	'write',
	'apply_patch',
	'shell',
];

function testConfigWithModels(
	models: OttoConfig['providers'][string]['models'],
) {
	return {
		projectRoot: '/tmp/project',
		defaults: {
			agent: 'build',
			provider: 'test-provider',
			model: 'catalog-model',
		},
		providers: {
			'test-provider': {
				enabled: true,
				custom: true,
				compatibility: 'openai-compatible',
				family: 'openai',
				models,
			},
		},
		paths: {
			projectConfigDir: '/tmp/project/.otto',
			projectConfigPath: null,
			projectStateDir: '/tmp/otto',
			dataDir: '/tmp/otto',
			dbPath: '/tmp/otto/db.sqlite',
			attachmentsDir: '/tmp/otto/attachments',
			debugDir: '/tmp/otto/debug',
			debugDumpsDir: '/tmp/otto/debug-dumps',
			logsDir: '/tmp/otto/logs',
			tmpDir: '/tmp/otto/tmp',
			cacheDir: '/tmp/otto/cache',
			globalConfigPath: null,
		},
	} satisfies OttoConfig;
}

describe('mergeProviderOptions', () => {
	test('preserves existing nested OpenAI OAuth instructions', () => {
		const base = {
			openai: {
				store: false,
				instructions: 'You are a coding agent.',
				parallelToolCalls: false,
			},
		};

		const incoming = {
			openai: {
				reasoningEffort: 'high',
				reasoningSummary: 'auto',
			},
		};

		const result = mergeProviderOptions(base, incoming);

		expect(result).toEqual({
			openai: {
				store: false,
				instructions: 'You are a coding agent.',
				parallelToolCalls: false,
				reasoningEffort: 'high',
				reasoningSummary: 'auto',
			},
		});
	});

	test('merges nested OpenRouter provider options without dropping existing routing config', () => {
		const base = {
			openrouter: {
				provider: {
					allow_fallbacks: true,
					require_parameters: true,
				},
			},
		};

		const incoming = {
			openrouter: {
				reasoning: {
					effort: 'medium',
				},
			},
		};

		const result = mergeProviderOptions(base, incoming);

		expect(result).toEqual({
			openrouter: {
				provider: {
					allow_fallbacks: true,
					require_parameters: true,
				},
				reasoning: {
					effort: 'medium',
				},
			},
		});
	});

	test('uses composed prompt as OpenAI OAuth instructions', () => {
		const result = buildCodexProviderOptions('Full composed prompt here');

		expect(result).toEqual({
			openai: {
				store: false,
				instructions: 'Full composed prompt here',
				parallelToolCalls: false,
			},
		});
	});
});

describe('applyModelFamilyEditToolPolicy', () => {
	test('keeps all editing tools for Anthropic-family build models', () => {
		const result = applyModelFamilyEditToolPolicy(
			'build',
			editPolicyTools,
			'anthropic',
			'claude-sonnet-4-20250514',
		);

		expect(result).toEqual([
			'read',
			'shell',
			'write',
			'edit',
			'multiedit',
			'copy_into',
			'apply_patch',
		]);
	});

	test('keeps all editing tools for OpenAI-family general models', () => {
		const result = applyModelFamilyEditToolPolicy(
			'general',
			editPolicyTools,
			'openrouter',
			'openai/gpt-4.1',
		);

		expect(result).toEqual([
			'read',
			'shell',
			'write',
			'edit',
			'multiedit',
			'copy_into',
			'apply_patch',
		]);
	});

	test('keeps apply_patch for non-Anthropic/OpenAI init models', () => {
		const result = applyModelFamilyEditToolPolicy(
			'init',
			editPolicyTools,
			'google',
			'gemini-2.5-flash',
		);

		expect(result).toEqual([
			'read',
			'shell',
			'write',
			'edit',
			'multiedit',
			'copy_into',
			'apply_patch',
		]);
	});

	test('keeps apply_patch for Kimi models', () => {
		const result = applyModelFamilyEditToolPolicy(
			'build',
			editPolicyTools,
			'kimi',
			'kimi-k2.7-code',
		);

		expect(result).toContain('apply_patch');
		expect(result).toEqual([
			'read',
			'shell',
			'write',
			'edit',
			'multiedit',
			'copy_into',
			'apply_patch',
		]);
	});

	test('uses structured edit tools for lower-tier build models across providers', () => {
		const result = applyModelFamilyEditToolPolicy(
			'build',
			editPolicyTools,
			'xai',
			'grok-composer-2.5-fast',
		);

		expect(result).toEqual([
			'read',
			'shell',
			'write',
			'edit',
			'multiedit',
			'copy_into',
			'apply_patch',
		]);
	});

	test('uses structured edit tools for OpenAI mini models', () => {
		const result = applyModelFamilyEditToolPolicy(
			'general',
			editPolicyTools,
			'openai',
			'gpt-5-mini',
		);

		expect(result).toEqual([
			'read',
			'shell',
			'write',
			'edit',
			'multiedit',
			'copy_into',
			'apply_patch',
		]);
	});

	test('uses structured edit tools for catalog low-cost models', () => {
		const cfg = testConfigWithModels([
			{
				id: 'catalog-low',
				cost: { input: 0.5, output: 3 },
				toolCall: true,
			},
		]);
		const result = applyModelFamilyEditToolPolicy(
			'build',
			editPolicyTools,
			'test-provider',
			'catalog-low',
			cfg,
		);

		expect(result).toEqual([
			'read',
			'shell',
			'write',
			'edit',
			'multiedit',
			'copy_into',
			'apply_patch',
		]);
	});

	test('uses explicit catalog edit tool capability overrides', () => {
		const cfg = testConfigWithModels([
			{
				id: 'catalog-explicit',
				cost: { input: 20, output: 100 },
				toolCall: true,
				editToolCapability: 'structured',
			},
		]);
		const result = applyModelFamilyEditToolPolicy(
			'build',
			editPolicyTools,
			'test-provider',
			'catalog-explicit',
			cfg,
		);

		expect(result).toEqual([
			'read',
			'shell',
			'write',
			'edit',
			'multiedit',
			'copy_into',
			'apply_patch',
		]);
	});

	test('normalizes legacy bash tool choices to shell', () => {
		const result = applyModelFamilyEditToolPolicy(
			'build',
			['read', 'edit', 'multiedit', 'write', 'apply_patch', 'bash'],
			'anthropic',
			'claude-sonnet-4-20250514',
		);

		expect(result).toEqual([
			'read',
			'shell',
			'write',
			'edit',
			'multiedit',
			'copy_into',
			'apply_patch',
		]);
	});

	test('does not rewrite tool choices for agents outside the policy set', () => {
		const tools = [
			'read',
			'edit',
			'multiedit',
			'write',
			'apply_patch',
			'shell',
		];
		const result = applyModelFamilyEditToolPolicy(
			'plan',
			tools,
			'google',
			'gemini-2.5-flash',
		);

		expect(result).toEqual(tools);
	});
});
