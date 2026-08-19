// biome-ignore-all lint/performance/noDynamicNamespaceImportAccess: This test verifies compatibility exports by name.
import { describe, expect, test } from 'bun:test';
import * as pluginApi from '../packages/sdk/src/plugins/index.ts';
import * as sdk from '@ottocode/sdk';

const publicPluginExports = [
	'pluginNameSchema',
	'pluginManifestSchema',
	'pluginConfigEntrySchema',
	'pluginsConfigSchema',
	'pluginRegistrySchema',
	'DEFAULT_PLUGIN_REGISTRY_URL',
	'loadPluginsConfig',
	'writePluginsConfig',
	'discoverPlugins',
	'resolveEffectivePlugins',
	'fetchPluginRegistry',
	'resolveRegistryPlugin',
	'installPlugin',
	'updatePlugin',
	'removePlugin',
	'setPluginEnabled',
	'syncPluginSkills',
] as const;

const pluginBarrelOnlyExports = [
	'pluginSourceSchema',
	'pluginSkillSchema',
] as const;

describe('plugin public exports', () => {
	test('preserves the plugin compatibility barrel', () => {
		for (const name of publicPluginExports) {
			expect(pluginApi[name]).toBeDefined();
		}
		for (const name of pluginBarrelOnlyExports) {
			expect(pluginApi[name]).toBeDefined();
		}
	});

	test('preserves SDK root plugin exports', () => {
		for (const name of publicPluginExports) {
			expect(sdk[name]).toBe(pluginApi[name]);
		}
	});

	test('rejects skill and filter paths that can escape plugin payloads', () => {
		const baseManifest = {
			name: 'path-test',
			version: '1.0.0',
		};

		expect(
			pluginApi.pluginManifestSchema.safeParse({
				...baseManifest,
				skills: [{ name: 'unsafe', path: '../outside/SKILL.md' }],
			}).success,
		).toBe(false);
		expect(
			pluginApi.pluginManifestSchema.safeParse({
				...baseManifest,
				skills: [
					{
						name: 'unsafe',
						source: {
							type: 'local',
							path: '/tmp/source',
							exclude: ['../outside.txt'],
						},
					},
				],
			}).success,
		).toBe(false);
	});
});
