import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
	fetchPluginRegistry,
	getGlobalPluginsConfigPath,
	getGlobalPluginsDir,
	getProjectPluginsConfigPath,
	getProjectPluginsDir,
	installPlugin,
	loadPluginsConfig,
	removePlugin,
	resolveEffectivePlugins,
	resolveRegistryPlugin,
	setPluginEnabled,
	updatePlugin,
	writePluginsConfig,
} from '@ottocode/sdk';

describe('plugins', () => {
	it('resolves project plugins before global plugins', async () => {
		const { projectRoot, cleanup } = await createPluginTestRoot(
			'otto-plugins-precedence-',
		);

		try {
			await writePluginPayload(getGlobalPluginsDir(), 'shared', '1.0.0');
			await writePluginPayload(
				getProjectPluginsDir(projectRoot),
				'shared',
				'2.0.0',
			);
			await writePluginsConfig('global', {
				version: 1,
				registries: [],
				plugins: {
					shared: { enabled: true, source: 'official:shared' },
				},
			});
			await writePluginsConfig(
				'project',
				{
					version: 1,
					registries: [],
					plugins: {
						shared: { enabled: true, source: 'local:shared' },
					},
				},
				projectRoot,
			);

			const effective = await resolveEffectivePlugins(projectRoot);
			const shared = effective.plugins.find(
				(plugin) => plugin.name === 'shared',
			);

			expect(shared?.scope).toBe('project');
			expect(shared?.enabled).toBe(true);
			expect(shared?.installed).toBe(true);
			expect(shared?.status).toBe('installed');
			expect(shared?.manifest?.version).toBe('2.0.0');
			expect(shared?.configEntry?.source).toBe('local:shared');
			expect(shared?.overriddenByProject).toBe(true);
		} finally {
			await cleanup();
		}
	});

	it('lets project config disable an installed global plugin', async () => {
		const { projectRoot, cleanup } = await createPluginTestRoot(
			'otto-plugins-disable-',
		);

		try {
			await writePluginPayload(getGlobalPluginsDir(), 'serve-sim', '1.0.0');
			await writePluginsConfig('global', {
				version: 1,
				registries: [],
				plugins: {
					'serve-sim': { enabled: true },
				},
			});
			await writePluginsConfig(
				'project',
				{
					version: 1,
					registries: [],
					plugins: {
						'serve-sim': { enabled: false },
					},
				},
				projectRoot,
			);

			const effective = await resolveEffectivePlugins(projectRoot);
			const serveSim = effective.plugins.find(
				(plugin) => plugin.name === 'serve-sim',
			);

			expect(serveSim?.scope).toBe('project');
			expect(serveSim?.enabled).toBe(false);
			expect(serveSim?.installed).toBe(true);
			expect(serveSim?.status).toBe('installed');
			expect(serveSim?.manifest?.version).toBe('1.0.0');
			expect(serveSim?.configEntry?.enabled).toBe(false);
			expect(serveSim?.overriddenByProject).toBe(true);
		} finally {
			await cleanup();
		}
	});

	it('reports configured plugins with missing payloads', async () => {
		const { projectRoot, cleanup } = await createPluginTestRoot(
			'otto-plugins-missing-',
		);

		try {
			await writePluginsConfig('global', {
				version: 1,
				registries: [],
				plugins: {
					missing: { enabled: true, source: 'official:missing' },
				},
			});

			const effective = await resolveEffectivePlugins(projectRoot);
			const missing = effective.plugins.find(
				(plugin) => plugin.name === 'missing',
			);

			expect(missing?.enabled).toBe(true);
			expect(missing?.installed).toBe(false);
			expect(missing?.status).toBe('missing');
			expect(missing?.error).toContain('Missing otto.plugin.json');
		} finally {
			await cleanup();
		}
	});

	it('loads and writes plugins config paths for each scope', async () => {
		const { projectRoot, cleanup } = await createPluginTestRoot(
			'otto-plugins-config-',
		);

		try {
			await writePluginsConfig('global', {
				version: 1,
				registries: ['https://example.test/registry.json'],
				plugins: {
					global: { enabled: true, version: '1.0.0' },
				},
			});
			await writePluginsConfig(
				'project',
				{
					version: 1,
					registries: [],
					plugins: {
						project: { enabled: false, pinned: true },
					},
				},
				projectRoot,
			);

			const globalConfig = await loadPluginsConfig('global');
			const projectConfig = await loadPluginsConfig('project', projectRoot);

			expect(getGlobalPluginsConfigPath()).toBe(
				join(projectRoot, 'xdg-config', 'otto', 'plugins.json'),
			);
			expect(getProjectPluginsConfigPath(projectRoot)).toBe(
				join(projectRoot, '.otto', 'plugins.json'),
			);
			expect(globalConfig.plugins.global?.version).toBe('1.0.0');
			expect(projectConfig.plugins.project?.enabled).toBe(false);
			expect(projectConfig.plugins.project?.pinned).toBe(true);
		} finally {
			await cleanup();
		}
	});

	it('fetches and resolves registry plugins from a local registry file', async () => {
		const { projectRoot, cleanup } = await createPluginTestRoot(
			'otto-plugins-registry-',
		);

		try {
			const payloadDir = join(projectRoot, 'registry-payload');
			await writePluginPayload(payloadDir, 'registry-plugin', '1.2.3');
			const registryPath = join(projectRoot, 'registry.json');
			await writeRegistry(
				registryPath,
				join(payloadDir, 'registry-plugin'),
				'registry-plugin',
				'1.2.3',
			);

			const registry = await fetchPluginRegistry({ url: registryPath });
			const resolved = await resolveRegistryPlugin('registry-plugin', {
				registries: [registryPath],
			});

			expect(registry.plugins).toHaveLength(1);
			expect(resolved.entry.name).toBe('registry-plugin');
			expect(resolved.entry.version).toBe('1.2.3');
		} finally {
			await cleanup();
		}
	});

	it('installs github-sourced registry plugins from sibling local paths when registry is local', async () => {
		const { projectRoot, cleanup } = await createPluginTestRoot(
			'otto-plugins-local-registry-github-',
		);

		try {
			const registryDir = join(projectRoot, 'plugin-registry');
			const payloadDir = join(registryDir, 'official', 'local-official');
			await writePluginPayload(
				join(registryDir, 'official'),
				'local-official',
				'1.4.0',
			);
			const registryPath = join(registryDir, 'registry.json');
			await writeFile(
				registryPath,
				`${JSON.stringify(
					{
						$schema: 'https://ottocode.ai/schemas/plugin-registry.json',
						version: 1,
						plugins: [
							{
								name: 'local-official',
								version: '1.4.0',
								description: 'local-official plugin',
								source: {
									type: 'github',
									repo: 'nitishxyz/otto',
									ref: 'main',
									path: 'packages/plugin-registry/official/local-official',
								},
							},
						],
					},
					null,
					2,
				)}\n`,
			);

			const installed = await installPlugin('local-official', {
				scope: 'project',
				projectRoot,
				registries: [registryPath],
				fetch: async () => {
					throw new Error(
						'GitHub fetch should not run for local registry payload',
					);
				},
			});

			expect(installed.name).toBe('local-official');
			expect(installed.installed).toBe(true);
			expect(installed.manifest?.version).toBe('1.4.0');
			expect(
				await Bun.file(join(payloadDir, 'otto.plugin.json')).exists(),
			).toBe(true);
		} finally {
			await cleanup();
		}
	});

	it('resolves registry-local source paths relative to the registry file', async () => {
		const { projectRoot, cleanup } = await createPluginTestRoot(
			'otto-plugins-local-registry-relative-',
		);

		try {
			const registryDir = join(projectRoot, 'plugin-registry');
			await writePluginPayload(
				join(registryDir, 'official'),
				'relative-official',
				'0.9.0',
			);
			const registryPath = join(registryDir, 'registry.json');
			await writeFile(
				registryPath,
				`${JSON.stringify(
					{
						$schema: 'https://ottocode.ai/schemas/plugin-registry.json',
						version: 1,
						plugins: [
							{
								name: 'relative-official',
								version: '0.9.0',
								description: 'relative-official plugin',
								source: {
									type: 'local',
									path: 'official/relative-official',
								},
							},
						],
					},
					null,
					2,
				)}\n`,
			);

			const installed = await installPlugin('relative-official', {
				scope: 'project',
				projectRoot,
				registries: [registryPath],
			});

			expect(installed.name).toBe('relative-official');
			expect(installed.manifest?.version).toBe('0.9.0');
		} finally {
			await cleanup();
		}
	});

	it('installs, disables, enables, updates, and removes registry plugins', async () => {
		const { projectRoot, cleanup } = await createPluginTestRoot(
			'otto-plugins-install-',
		);

		try {
			const payloadDir = join(projectRoot, 'registry-payload');
			await writePluginPayload(payloadDir, 'registry-plugin', '1.0.0');
			const registryPath = join(projectRoot, 'registry.json');
			await writeRegistry(
				registryPath,
				join(payloadDir, 'registry-plugin'),
				'registry-plugin',
				'1.0.0',
			);

			const installed = await installPlugin('registry-plugin', {
				scope: 'project',
				projectRoot,
				registries: [registryPath],
			});
			expect(installed.scope).toBe('project');
			expect(installed.installed).toBe(true);
			expect(installed.configEntry?.source).toBe('registry:registry-plugin');

			await setPluginEnabled('registry-plugin', false, {
				scope: 'project',
				projectRoot,
			});
			let effective = await resolveEffectivePlugins(projectRoot);
			expect(
				effective.plugins.find((plugin) => plugin.name === 'registry-plugin')
					?.enabled,
			).toBe(false);

			await setPluginEnabled('registry-plugin', true, {
				scope: 'project',
				projectRoot,
			});
			effective = await resolveEffectivePlugins(projectRoot);
			expect(
				effective.plugins.find((plugin) => plugin.name === 'registry-plugin')
					?.enabled,
			).toBe(true);

			await writePluginPayload(payloadDir, 'registry-plugin', '2.0.0');
			await writeRegistry(
				registryPath,
				join(payloadDir, 'registry-plugin'),
				'registry-plugin',
				'2.0.0',
			);
			const updated = await updatePlugin('registry-plugin', {
				scope: 'project',
				projectRoot,
				registries: [registryPath],
			});
			expect(updated.manifest?.version).toBe('2.0.0');

			await removePlugin('registry-plugin', { scope: 'project', projectRoot });
			effective = await resolveEffectivePlugins(projectRoot);
			expect(
				effective.plugins.find((plugin) => plugin.name === 'registry-plugin'),
			).toBeUndefined();
		} finally {
			await cleanup();
		}
	});

	it('installs local directory plugins into the requested scope', async () => {
		const { projectRoot, cleanup } = await createPluginTestRoot(
			'otto-plugins-local-',
		);

		try {
			const localDir = join(projectRoot, 'local-plugin');
			await writePluginPayload(localDir, 'local-plugin', '0.1.0');

			const sourceDir = join(localDir, 'local-plugin');
			const installed = await installPlugin(sourceDir, {
				scope: 'project',
				projectRoot,
			});

			expect(installed.name).toBe('local-plugin');
			expect(installed.scope).toBe('project');
			expect(installed.configEntry?.source).toBe(`local:${sourceDir}`);
			expect(installed.manifest?.version).toBe('0.1.0');
		} finally {
			await cleanup();
		}
	});

	it('materializes source-backed registry skills into the plugin directory', async () => {
		const { projectRoot, cleanup } = await createPluginTestRoot(
			'otto-plugins-skill-source-',
		);

		try {
			const skillSourceDir = join(projectRoot, 'skill-source');
			await writeSkillBundle(skillSourceDir, 'remote-skill');
			const registryPath = join(projectRoot, 'registry.json');
			await writeInlineRegistryWithSkillSource(registryPath, skillSourceDir);

			const installed = await installPlugin('source-plugin', {
				scope: 'project',
				projectRoot,
				registries: [registryPath],
			});

			expect(installed.name).toBe('source-plugin');
			expect(installed.manifest?.skills?.[0]?.path).toBe(
				'skills/remote-skill/SKILL.md',
			);
			const installedSkill = await readFile(
				join(
					getProjectPluginsDir(projectRoot),
					'source-plugin',
					'skills',
					'remote-skill',
					'SKILL.md',
				),
				'utf-8',
			);
			expect(installedSkill).toContain('name: remote-skill');
			expect(
				await Bun.file(
					join(
						getProjectPluginsDir(projectRoot),
						'source-plugin',
						'skills',
						'remote-skill',
						'references',
						'details.md',
					),
				).exists(),
			).toBe(true);
			expect(
				await Bun.file(
					join(
						getProjectPluginsDir(projectRoot),
						'source-plugin',
						'skills',
						'remote-skill',
						'README.md',
					),
				).exists(),
			).toBe(false);
			expect(
				await Bun.file(
					join(
						getProjectPluginsDir(projectRoot),
						'source-plugin',
						'skills',
						'remote-skill',
						'evals',
					),
				).exists(),
			).toBe(false);
			expect(
				await Bun.file(
					join(
						getProjectPluginsDir(projectRoot),
						'source-plugin',
						'skills',
						'remote-skill',
						'scripts',
					),
				).exists(),
			).toBe(false);
		} finally {
			await cleanup();
		}
	});
});

async function createPluginTestRoot(prefix: string): Promise<{
	projectRoot: string;
	cleanup: () => Promise<void>;
}> {
	const projectRoot = await mkdtemp(join(tmpdir(), prefix));
	const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
	process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');

	return {
		projectRoot,
		cleanup: async () => {
			if (previousXdgConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
			}
			await rm(projectRoot, { recursive: true, force: true });
		},
	};
}

async function writePluginPayload(
	pluginsDir: string,
	name: string,
	version: string,
): Promise<void> {
	const pluginDir = join(pluginsDir, name);
	await mkdir(pluginDir, { recursive: true });
	await writeFile(
		join(pluginDir, 'otto.plugin.json'),
		`${JSON.stringify(
			{
				$schema: 'https://ottocode.ai/schemas/plugin.json',
				name,
				version,
				description: `${name} plugin`,
			},
			null,
			2,
		)}\n`,
	);
}

async function writeRegistry(
	registryPath: string,
	payloadDir: string,
	name: string,
	version: string,
): Promise<void> {
	await writeFile(
		registryPath,
		`${JSON.stringify(
			{
				$schema: 'https://ottocode.ai/schemas/plugin-registry.json',
				version: 1,
				plugins: [
					{
						name,
						version,
						description: `${name} plugin`,
						source: { type: 'local', path: payloadDir },
					},
				],
			},
			null,
			2,
		)}\n`,
	);
}

async function writeSkillBundle(dir: string, name: string): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, 'SKILL.md'),
		`---\nname: ${name}\ndescription: Test skill from an external source.\n---\n\n# ${name}\n`,
	);
	await mkdir(join(dir, 'references'), { recursive: true });
	await writeFile(join(dir, 'references', 'details.md'), '# Details\n');
	await writeFile(join(dir, 'README.md'), '# Readme\n');
	await mkdir(join(dir, 'evals'), { recursive: true });
	await writeFile(join(dir, 'evals', 'case.md'), '# Eval\n');
	await mkdir(join(dir, 'scripts'), { recursive: true });
	await writeFile(join(dir, 'scripts', 'check.sh'), '#!/bin/sh\n');
}

async function writeInlineRegistryWithSkillSource(
	registryPath: string,
	skillSourceDir: string,
): Promise<void> {
	await writeFile(
		registryPath,
		`${JSON.stringify(
			{
				$schema: 'https://ottocode.ai/schemas/plugin-registry.json',
				version: 1,
				plugins: [
					{
						name: 'source-plugin',
						version: '1.0.0',
						description: 'source-plugin plugin',
						skills: [
							{
								name: 'remote-skill',
								description: 'Test skill from an external source.',
								source: {
									type: 'local',
									path: skillSourceDir,
									include: ['SKILL.md', 'references/**'],
								},
							},
						],
					},
				],
			},
			null,
			2,
		)}\n`,
	);
}
