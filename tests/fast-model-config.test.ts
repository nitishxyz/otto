import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
	getConfiguredFastModelForAuth,
	getGlobalConfigPath,
	loadConfig,
} from '@ottocode/sdk';

describe('configured fast model selection', () => {
	test('uses global provider fastModels and local defaults precedence', async () => {
		const projectRoot = await mkdtemp(
			join(tmpdir(), 'otto-fast-model-config-'),
		);
		const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
		const previousOttoHome = process.env.OTTO_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		process.env.OTTO_HOME = join(projectRoot, 'otto-home');

		try {
			const globalConfigPath = getGlobalConfigPath();
			await mkdir(dirname(globalConfigPath), { recursive: true });
			await Bun.write(
				globalConfigPath,
				JSON.stringify(
					{
						defaults: {
							provider: 'minimax',
							model: 'MiniMax-M2',
						},
						providers: {
							minimax: {
								fastModels: ['MiniMax-M2.5'],
							},
							customfast: {
								enabled: true,
								custom: true,
								compatibility: 'openai-compatible',
								models: {
									'slow-model': { id: 'slow-model' },
									'fast-model': { id: 'fast-model' },
								},
								fastModels: ['fast-model'],
							},
							customslow: {
								enabled: true,
								custom: true,
								compatibility: 'openai-compatible',
								models: {
									'slow-model': { id: 'slow-model' },
									'fast-model': { id: 'fast-model' },
								},
							},
						},
					},
					null,
					2,
				),
			);

			const localConfigDir = join(projectRoot, '.otto');
			await mkdir(localConfigDir, { recursive: true });
			await Bun.write(
				join(localConfigDir, 'config.json'),
				JSON.stringify(
					{
						defaults: {
							provider: 'openai',
							model: 'local-model',
						},
						providers: {
							minimax: {
								fastModels: ['MiniMax-M2.7-highspeed'],
							},
						},
					},
					null,
					2,
				),
			);

			const cfg = await loadConfig(projectRoot);

			expect(cfg.defaults.provider).toBe('openai');
			expect(cfg.defaults.model).toBe('local-model');
			expect(cfg.providers.minimax.fastModels).toEqual(['MiniMax-M2.5']);
			expect(getConfiguredFastModelForAuth(cfg, 'minimax', 'api')).toBe(
				'MiniMax-M2.5',
			);
			expect(getConfiguredFastModelForAuth(cfg, 'customfast', 'api')).toBe(
				'fast-model',
			);
			expect(getConfiguredFastModelForAuth(cfg, 'customslow', 'api')).toBe(
				undefined,
			);
		} finally {
			if (previousXdgConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
			}
			if (previousOttoHome === undefined) {
				delete process.env.OTTO_HOME;
			} else {
				process.env.OTTO_HOME = previousOttoHome;
			}
			await rm(projectRoot, { recursive: true, force: true });
		}
	});
});
