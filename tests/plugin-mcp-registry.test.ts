import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
	getGlobalConfigDir,
	getGlobalPluginsDir,
	getProjectPluginsDir,
	loadEffectiveMCPConfig,
	writePluginsConfig,
} from '@ottocode/sdk';
import { listMCPServers } from '../packages/server/src/routes/mcp/service/servers.ts';

describe('effective MCP registry', () => {
	async function setupProject() {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-plugin-mcp-'));
		process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
		await mkdir(join(projectRoot, '.otto'), { recursive: true });
		return {
			projectRoot,
			cleanup: async () => {
				await rm(projectRoot, { recursive: true, force: true });
			},
		};
	}

	async function installPlugin(
		projectRoot: string,
		options: {
			name: string;
			scopeDir: 'global' | 'project';
			enabled?: boolean;
			mcpServers?: Record<string, unknown>;
		},
	) {
		const pluginsDir =
			options.scopeDir === 'global'
				? getGlobalPluginsDir()
				: getProjectPluginsDir(projectRoot);
		const pluginDir = join(pluginsDir, options.name);
		await mkdir(pluginDir, { recursive: true });
		await writeFile(
			join(pluginDir, 'otto.plugin.json'),
			`${JSON.stringify(
				{
					name: options.name,
					version: '1.0.0',
					mcpServers: options.mcpServers ?? {},
				},
				null,
				2,
			)}\n`,
		);
		await writePluginsConfig(
			options.scopeDir,
			{
				version: 1,
				registries: [],
				plugins: {
					[options.name]: { enabled: options.enabled ?? true },
				},
			},
			options.scopeDir === 'project' ? projectRoot : undefined,
		);
	}

	async function writeUserMcpConfig(
		projectRoot: string,
		scope: 'global' | 'project',
		servers: Array<Record<string, unknown>>,
	) {
		const configPath =
			scope === 'global'
				? join(getGlobalConfigDir(), 'config.json')
				: join(projectRoot, '.otto', 'config.json');
		await mkdir(configPath.slice(0, configPath.lastIndexOf('/')), {
			recursive: true,
		});
		await writeFile(
			configPath,
			`${JSON.stringify({ mcp: { servers } }, null, 2)}\n`,
		);
	}

	it('includes enabled plugin MCP servers with plugin source metadata', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, {
				name: 'serve-sim',
				scopeDir: 'project',
				mcpServers: {
					'serve-sim': {
						command: 'bun',
						args: ['x', 'serve-sim-mcp@latest'],
					},
				},
			});

			const config = await loadEffectiveMCPConfig(
				projectRoot,
				getGlobalConfigDir(),
			);
			expect(config.servers).toEqual([
				expect.objectContaining({
					name: 'serve-sim',
					command: 'bun',
					scope: 'project',
					source: {
						kind: 'plugin',
						scope: 'project',
						plugin: 'serve-sim',
					},
				}),
			]);
		} finally {
			await cleanup();
		}
	});

	it('omits MCP servers from disabled plugins', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, {
				name: 'hidden-plugin',
				scopeDir: 'project',
				enabled: false,
				mcpServers: {
					hidden: { command: 'echo', args: ['hidden'] },
				},
			});

			const config = await loadEffectiveMCPConfig(
				projectRoot,
				getGlobalConfigDir(),
			);
			expect(config.servers).toEqual([]);
		} finally {
			await cleanup();
		}
	});

	it('applies precedence: project user overrides project plugin overrides global user overrides global plugin', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, {
				name: 'global-plugin',
				scopeDir: 'global',
				mcpServers: {
					lowest: { command: 'echo', args: ['global-plugin'] },
					shared: { command: 'echo', args: ['global-plugin-shared'] },
				},
			});
			await installPlugin(projectRoot, {
				name: 'project-plugin',
				scopeDir: 'project',
				mcpServers: {
					middle: { command: 'echo', args: ['project-plugin'] },
					shared: { command: 'echo', args: ['project-plugin-shared'] },
				},
			});
			await writeUserMcpConfig(projectRoot, 'global', [
				{ name: 'global-user', command: 'echo', args: ['global-user'] },
				{
					name: 'shared',
					command: 'echo',
					args: ['global-user-shared'],
				},
			]);
			await writeUserMcpConfig(projectRoot, 'project', [
				{ name: 'project-user', command: 'echo', args: ['project-user'] },
				{
					name: 'shared',
					command: 'echo',
					args: ['project-user-shared'],
				},
			]);

			const config = await loadEffectiveMCPConfig(
				projectRoot,
				getGlobalConfigDir(),
			);
			const byName = Object.fromEntries(
				config.servers.map((server) => [server.name, server]),
			);

			expect(byName.lowest?.args).toEqual(['global-plugin']);
			expect(byName['global-user']?.args).toEqual(['global-user']);
			expect(byName.middle?.args).toEqual(['project-plugin']);
			expect(byName['project-user']?.args).toEqual(['project-user']);
			expect(byName.shared?.args).toEqual(['project-user-shared']);
			expect(byName.shared?.source).toEqual({
				kind: 'user',
				scope: 'project',
				overridesPlugin: 'project-plugin',
			});
		} finally {
			await cleanup();
		}
	});

	it('exposes source metadata from the MCP list API', async () => {
		const { projectRoot, cleanup } = await setupProject();
		try {
			await installPlugin(projectRoot, {
				name: 'serve-sim',
				scopeDir: 'project',
				mcpServers: {
					'serve-sim': { command: 'echo', args: ['plugin-list'] },
				},
			});

			const servers = await listMCPServers(projectRoot);
			expect(servers).toEqual([
				expect.objectContaining({
					name: 'serve-sim',
					sourceKind: 'plugin',
					sourcePlugin: 'serve-sim',
					sourceLabel: 'plugin: serve-sim',
					managedByPlugin: true,
					scope: 'project',
				}),
			]);
		} finally {
			await cleanup();
		}
	});
});
