import { describe, expect, test } from 'bun:test';
import {
	catalog,
	getFastModel,
	getProviderDefinition,
	providerEnvVar,
	type OttoConfig,
} from '@ottocode/sdk';

const WAFER_BASE_URL = 'https://pass.wafer.ai/v1';
const WAFER_FAST_MODEL = 'deepseek-v4-flash';

function createConfig(): OttoConfig {
	return {
		projectRoot: process.cwd(),
		defaults: {
			agent: 'build',
			provider: 'wafer',
			model: WAFER_FAST_MODEL,
			toolApproval: 'auto',
			guidedMode: false,
			reasoningText: true,
			reasoningLevel: 'high',
			fullWidthContent: true,
			autoCompactThresholdTokens: null,
		},
		providers: {
			wafer: { enabled: true },
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

describe('Wafer provider', () => {
	test('uses Wafer API key environment variable', () => {
		expect(providerEnvVar('wafer')).toBe('WAFER_API_KEY');
		expect(catalog.wafer.env).toEqual(['WAFER_API_KEY']);
	});

	test('resolves as an OpenAI-compatible provider', () => {
		const definition = getProviderDefinition(createConfig(), 'wafer');

		expect(definition).toMatchObject({
			id: 'wafer',
			label: 'Wafer',
			source: 'built-in',
			compatibility: 'openai-compatible',
			family: 'openai-compatible',
			baseURL: WAFER_BASE_URL,
			apiKeyEnv: 'WAFER_API_KEY',
			allowAnyModel: false,
		});
		expect(getFastModel('wafer')).toBe(WAFER_FAST_MODEL);
	});

	test('contains Wafer models from models.dev', () => {
		const models = new Set(Object.keys(catalog.wafer.models));

		for (const model of [
			'deepseek-v4-flash',
			'deepseek-v4-pro',
			'Qwen3.6-35B-A3B',
			'Qwen3.5-397B-A17B',
			'Kimi-K2.6',
			'GLM-5.1',
			'GLM-5.2',
		]) {
			expect(models.has(model)).toBe(true);
		}
	});
});
