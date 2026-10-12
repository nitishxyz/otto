import {
	discoverSkills,
	findGitRoot,
	getGlobalConfigDir,
	resolveEffectivePlugins,
	type DiscoveredPlugin,
} from '@ottocode/sdk';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { getAllAgentDetails } from '../agent/config-management.ts';
import { discoverAllRecipes, getRecipesDir } from '../commands/recipes.ts';
import { listForgeAuth } from './auth.ts';
import { listForgeMCPServers } from './mcp.ts';
import { listForgeProviders } from './provider.ts';
import { runForgeTunnelAction } from './tunnel.ts';

const PLUGIN_SKILL_MARKER_FILE = '.otto-plugin';

function isInside(root: string, path: string): boolean {
	const rel = relative(resolve(root), resolve(path));
	return Boolean(rel) && !rel.startsWith('..') && !rel.startsWith(sep);
}

function isPluginMutable(plugin: DiscoveredPlugin): boolean {
	const source = plugin.configEntry?.source;
	return !source?.startsWith('official:') && !source?.startsWith('registry:');
}

function ownerByPath(
	plugins: DiscoveredPlugin[],
	path: string,
): DiscoveredPlugin | undefined {
	return plugins.find((plugin) => isInside(plugin.dir, path));
}

async function syncedSkillOwner(skillPath: string): Promise<string | null> {
	try {
		const owner = (
			await readFile(join(dirname(skillPath), PLUGIN_SKILL_MARKER_FILE), 'utf8')
		).trim();
		return owner || null;
	} catch {
		return null;
	}
}

function forgeSkillPaths(projectRoot: string, name: string): string[] {
	return [
		resolve(projectRoot, '.otto', 'skills', name, 'SKILL.md'),
		resolve(getGlobalConfigDir(), 'skills', name, 'SKILL.md'),
	];
}

/**
 * Inventory of every Forge-managed capability. Provenance is derived from the
 * source path (a capability belongs to a plugin only when its file lives in
 * that plugin's payload or was synced from it), and `mutable` reflects whether
 * Forge can actually edit it in place.
 */
export async function getForgeInventory(projectRoot: string) {
	const repoRoot = (await findGitRoot(projectRoot)) ?? projectRoot;
	const [
		recipes,
		skills,
		agentDetails,
		effectivePlugins,
		mcpServers,
		providers,
		auth,
		tunnel,
	] = await Promise.all([
		discoverAllRecipes(projectRoot),
		discoverSkills(projectRoot, repoRoot),
		getAllAgentDetails(projectRoot),
		resolveEffectivePlugins(projectRoot),
		listForgeMCPServers(projectRoot),
		listForgeProviders(projectRoot),
		listForgeAuth(projectRoot),
		runForgeTunnelAction({ action: 'status', kind: 'tunnel' }),
	]);
	const installedPlugins = effectivePlugins.plugins.filter(
		(plugin) => plugin.status === 'installed' && plugin.manifest,
	);
	const pluginsByName = new Map(
		installedPlugins.map((plugin) => [plugin.name, plugin]),
	);
	const agentOwners = new Map<string, DiscoveredPlugin>();
	for (const plugin of installedPlugins) {
		for (const agent of plugin.manifest?.agents ?? []) {
			agentOwners.set(agent.name.toLowerCase(), plugin);
		}
	}
	const recipeDirs = [
		resolve(getRecipesDir('project', projectRoot)),
		resolve(getRecipesDir('global', projectRoot)),
	];

	const skillEntries = await Promise.all(
		skills.map(async (skill) => {
			const owner =
				ownerByPath(installedPlugins, skill.path) ??
				pluginsByName.get((await syncedSkillOwner(skill.path)) ?? '');
			const editableInPlace = forgeSkillPaths(projectRoot, skill.name).includes(
				resolve(skill.path),
			);
			return {
				name: skill.name,
				scope: skill.scope,
				description: skill.description,
				path: skill.path,
				source: owner ? 'plugin' : 'standalone',
				plugin: owner?.name,
				mutable: owner ? isPluginMutable(owner) : editableInPlace,
			};
		}),
	);

	return {
		projectRoot,
		recipes: recipes.map((recipe) => {
			const owner = ownerByPath(installedPlugins, recipe.path);
			return {
				name: recipe.name,
				scope: recipe.scope,
				description: recipe.description,
				path: recipe.path,
				source: owner ? 'plugin' : 'standalone',
				plugin: owner?.name,
				mutable: owner
					? isPluginMutable(owner)
					: recipeDirs.some((dir) => isInside(dir, recipe.path)),
			};
		}),
		skills: skillEntries,
		agents: agentDetails.agents.map((agent) => {
			const owner = agentOwners.get(agent.name);
			return {
				name: agent.name,
				source: agent.source,
				description: agent.description ?? agent.defaultDescription,
				provider: agent.provider,
				model: agent.model,
				hasProjectOverride: agent.hasLocalOverride,
				hasGlobalOverride: agent.hasGlobalOverride,
				plugin: owner?.name,
				mutable: owner ? isPluginMutable(owner) : true,
			};
		}),
		mcpServers,
		providers,
		auth,
		tunnel: tunnel.tunnel,
		plugins: effectivePlugins.plugins.map((plugin) => ({
			name: plugin.name,
			scope: plugin.scope,
			dir: plugin.dir,
			manifestPath: plugin.manifestPath,
			enabled: plugin.enabled,
			installed: plugin.installed,
			status: plugin.status,
			source: plugin.configEntry?.source,
			mutable: isPluginMutable(plugin),
			version: plugin.manifest?.version,
			description: plugin.manifest?.description,
			capabilities: {
				recipes: plugin.manifest?.recipes?.length ?? 0,
				skills: plugin.manifest?.skills?.length ?? 0,
				agents: plugin.manifest?.agents?.length ?? 0,
				commands: Object.keys(plugin.manifest?.commands ?? {}).length,
				tools: plugin.manifest?.tools?.length ?? 0,
				mcpServers: Object.keys(plugin.manifest?.mcpServers ?? {}).length,
			},
			commands: Object.entries(plugin.manifest?.commands ?? {}).map(
				([name, command]) => ({
					name,
					label: command.label,
					description: command.description,
					parameters: command.parameters,
				}),
			),
			recipes: (plugin.manifest?.recipes ?? []).map((recipe) => ({
				name: recipe.name,
				path: recipe.path,
				description: recipe.description,
			})),
			skills: (plugin.manifest?.skills ?? []).map((skill) => ({
				name: skill.name,
				path: skill.path,
				description: skill.description,
			})),
			agents: (plugin.manifest?.agents ?? []).map((agent) => ({
				name: agent.name,
				path: agent.path,
				description: agent.description,
			})),
			tools: (plugin.manifest?.tools ?? []).map((tool) => ({
				name: tool.name,
				fullName: `${plugin.name}__${tool.name}`,
				description: tool.description,
				entry: tool.entry,
				effects: tool.effects,
				timeoutMs: tool.timeoutMs,
			})),
		})),
	};
}
