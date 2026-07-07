import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
	installPlugin,
	loadPluginsConfig,
	pluginManifestSchema,
	pluginRegistrySchema,
} from '@ottocode/sdk';

function stubSkillFetch(): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('api.github.com/repos/nitishxyz/otto')) {
			throw new Error('Unexpected GitHub fetch for otto registry payload');
		}
		const contentsMatch = url.match(
			/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/([^?]+)/,
		);
		if (contentsMatch) {
			const path = decodeURIComponent(contentsMatch[1] ?? '');
			return Response.json([
				{
					name: 'SKILL.md',
					path: `${path}/SKILL.md`,
					type: 'file',
					download_url: `https://stub.local/${path}/SKILL.md`,
				},
			]);
		}
		if (url.startsWith('https://stub.local/')) {
			return new Response(
				'---\nname: stub\ndescription: stub skill\n---\n\nStub skill content.\n',
			);
		}
		throw new Error(`Unexpected network fetch in test: ${url}`);
	}) as typeof fetch;
}

describe('expo official plugin registry', () => {
	it('declares dependencies and the expo agent in the bundled registry', async () => {
		const raw = await readFile(
			join(import.meta.dir, '../packages/plugin-registry/registry.json'),
			'utf8',
		);
		const registry = pluginRegistrySchema.parse(JSON.parse(raw));
		const expo = registry.plugins.find((plugin) => plugin.name === 'expo');
		expect(expo).toBeDefined();
		expect(expo?.official).toBe(true);
		expect(expo?.dependencies).toEqual(['argent', 'serve-sim']);
		const agent = expo?.agents?.find((entry) => entry.name === 'expo');
		expect(agent?.path).toBe('agents/expo.md');
		expect(agent?.tools?.firstClass).toContain('shell');
		expect(agent?.tools?.loadable).toContain('simulator');
	});

	it('validates the official expo plugin manifest and agent prompt', async () => {
		const pluginDir = join(
			import.meta.dir,
			'../packages/plugin-registry/official/expo',
		);
		const raw = await readFile(join(pluginDir, 'otto.plugin.json'), 'utf8');
		const manifest = pluginManifestSchema.parse(JSON.parse(raw));
		expect(manifest.dependencies).toEqual(['argent', 'serve-sim']);
		const agent = manifest.agents?.find((entry) => entry.name === 'expo');
		expect(agent?.path).toBe('agents/expo.md');
		const prompt = await readFile(join(pluginDir, 'agents/expo.md'), 'utf8');
		expect(prompt).toContain('Tool routing');
		expect(prompt).toContain('Argent');
		expect(prompt).toContain('simulator');
	});

	it('installs expo with argent and serve-sim as dependencies from the bundled registry', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-expo-install-'));
		const previousXdg = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		const registryPath = join(
			import.meta.dir,
			'../packages/plugin-registry/registry.json',
		);

		try {
			const installed = await installPlugin('expo', {
				scope: 'project',
				projectRoot,
				registries: [registryPath],
				fetch: stubSkillFetch(),
			});

			expect(installed.name).toBe('expo');
			expect(installed.installed).toBe(true);

			const config = await loadPluginsConfig('project', projectRoot);
			expect(config.plugins.argent?.enabled).toBe(true);
			expect(config.plugins.argent?.installedBy).toEqual(['expo']);
			if (process.platform === 'darwin') {
				expect(config.plugins['serve-sim']?.enabled).toBe(true);
				expect(config.plugins['serve-sim']?.installedBy).toEqual(['expo']);
			} else {
				expect(config.plugins['serve-sim']).toBeUndefined();
			}
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
