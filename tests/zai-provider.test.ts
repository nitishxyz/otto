import { describe, expect, test } from 'bun:test';
import {
	catalog,
	modelMapToList,
	validateProviderModel,
	type OttoConfig,
} from '@ottocode/sdk';

function createConfig(): OttoConfig {
	return {
		projectRoot: process.cwd(),
		defaults: {
			agent: 'build',
			provider: 'zai',
			model: 'glm-5.2',
			toolApproval: 'auto',
			guidedMode: false,
			reasoningText: true,
			reasoningLevel: 'high',
			fullWidthContent: true,
			autoCompactThresholdTokens: null,
		},
		providers: {
			zai: { enabled: true },
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

describe('Z.AI provider catalog', () => {
	test('includes glm-5.2 in the zai provider catalog', () => {
		const models = new Set(Object.keys(catalog.zai.models));

		expect(models.has('glm-5.2')).toBe(true);
		expect(() =>
			validateProviderModel('zai', 'glm-5.2', createConfig()),
		).not.toThrow();
	});

	test('prioritizes glm-5.2 in the zai model list', () => {
		expect(modelMapToList(catalog.zai.models)[0]?.id).toBe('glm-5.2');
	});
});
