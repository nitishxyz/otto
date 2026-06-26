import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
	fetchPluginRegistry,
	getProjectPluginsDir,
	installPlugin,
	pluginManifestSchema,
	pluginRegistrySchema,
} from '@ottocode/sdk';

const EXPECTED_ARGENT_SKILL_NAMES = [
	'argent-android-emulator-setup',
	'argent-create-flow',
	'argent-device-interact',
	'argent-ios-simulator-setup',
	'argent-lens',
	'argent-metro-debugger',
	'argent-native-profiler',
	'argent-react-native-app-workflow',
	'argent-react-native-optimization',
	'argent-react-native-profiler',
	'argent-screenshot-diff',
	'argent-test-ui-flow',
	'argent-vega',
] as const;

describe('argent official plugin registry', () => {
	it('parses the bundled registry including argent', async () => {
		const raw = await readFile(
			join(import.meta.dir, '../packages/plugin-registry/registry.json'),
			'utf8',
		);
		const registry = pluginRegistrySchema.parse(JSON.parse(raw));
		const argent = registry.plugins.find((plugin) => plugin.name === 'argent');
		expect(argent).toBeDefined();
		expect(argent?.official).toBe(true);
		expect(argent?.homepage).toBe('https://argent.swmansion.com');
		expect(argent?.mcpServers?.argent).toEqual({
			command: 'npx',
			args: ['-y', '@swmansion/argent', 'mcp'],
		});
		expect(argent?.skills?.map((skill) => skill.name).sort()).toEqual(
			[...EXPECTED_ARGENT_SKILL_NAMES].sort(),
		);
	});

	it('validates the official argent plugin manifest', async () => {
		const raw = await readFile(
			join(
				import.meta.dir,
				'../packages/plugin-registry/official/argent/otto.plugin.json',
			),
			'utf8',
		);
		const manifest = pluginManifestSchema.parse(JSON.parse(raw));
		expect(manifest.commands?.init?.args).toEqual([
			'-y',
			'@swmansion/argent',
			'init',
		]);
		expect(manifest.mcpServers?.argent).toEqual({
			command: 'npx',
			args: ['-y', '@swmansion/argent', 'mcp'],
		});
		expect(manifest.skills?.map((skill) => skill.name).sort()).toEqual(
			[...EXPECTED_ARGENT_SKILL_NAMES].sort(),
		);
		expect(manifest.skills).toHaveLength(EXPECTED_ARGENT_SKILL_NAMES.length);
	});

	it('loads registry via fetchPluginRegistry from local file URL', async () => {
		const registryPath = join(
			import.meta.dir,
			'../packages/plugin-registry/registry.json',
		);
		const registry = await fetchPluginRegistry({
			url: `file://${registryPath}`,
		});
		expect(registry.plugins.some((plugin) => plugin.name === 'argent')).toBe(
			true,
		);
	});

	it('installs argent from the bundled local registry without fetching otto github payload', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-argent-install-'));
		const previousXdg = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		const registryPath = join(
			import.meta.dir,
			'../packages/plugin-registry/registry.json',
		);

		try {
			const installed = await installPlugin('argent', {
				scope: 'project',
				projectRoot,
				registries: [registryPath],
				fetch: async (input) => {
					const url = String(input);
					if (url.includes('api.github.com/repos/nitishxyz/otto')) {
						throw new Error(
							'Unexpected GitHub fetch for otto registry payload',
						);
					}
					return fetch(input);
				},
			});

			expect(installed.name).toBe('argent');
			expect(installed.installed).toBe(true);
			expect(installed.manifest?.version).toBe('0.13.0');
			expect(
				await Bun.file(
					join(
						getProjectPluginsDir(projectRoot),
						'argent',
						'recipes',
						'setup-argent.md',
					),
				).exists(),
			).toBe(true);
		} finally {
			if (previousXdg === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = previousXdg;
			}
			await rm(projectRoot, { recursive: true, force: true });
		}
	}, 120_000);
});
