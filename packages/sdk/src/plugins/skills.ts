import { cp, readdir, rm, rmdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import {
	ensureDir,
	fileExists,
	getGlobalAgentsSkillsDir,
	getProjectAgentsSkillsDir,
	joinPath,
} from '../config/src/paths.ts';
import { normalizeSkillFrontmatter } from '../skills/frontmatter.ts';
import { discoverPlugins } from './discovery.ts';
import { normalizeSourcePattern } from './source.ts';
import type {
	DiscoveredPlugin,
	PluginManifest,
	PluginScope,
} from './schema.ts';

const PLUGIN_SKILL_MARKER_FILE = '.otto-plugin';

function getAgentsSkillsDir(scope: PluginScope, projectRoot?: string): string {
	if (scope === 'global') return getGlobalAgentsSkillsDir();
	if (!projectRoot)
		throw new Error('projectRoot is required for project plugins');
	return getProjectAgentsSkillsDir(projectRoot);
}

function parentPath(path: string): string {
	const index = path.lastIndexOf('/');
	return index > 0 ? path.slice(0, index) : path;
}

/** Remove skills previously synced into .agents/skills for a plugin. */
export async function removeSyncedPluginSkills(
	pluginName: string,
	scope: PluginScope,
	projectRoot?: string,
): Promise<void> {
	const skillsDir = getAgentsSkillsDir(scope, projectRoot);
	let entries: Dirent<string>[];
	try {
		entries = await readdir(skillsDir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const dir = joinPath(skillsDir, entry.name);
		const marker = Bun.file(joinPath(dir, PLUGIN_SKILL_MARKER_FILE));
		try {
			if (!(await marker.exists())) continue;
			if ((await marker.text()).trim() !== pluginName) continue;
		} catch {
			continue;
		}
		await rm(dir, { recursive: true, force: true });
	}
	await removeDirIfEmpty(skillsDir);
}

async function removeDirIfEmpty(dir: string): Promise<void> {
	try {
		await rmdir(dir);
	} catch {}
}

/**
 * Re-sync all plugin skills into .agents/skills and remove synced skills
 * whose owning plugin is no longer installed and enabled. Use this to
 * backfill existing installs or clean up after manual plugin removal.
 */
export async function syncPluginSkills(projectRoot: string): Promise<void> {
	const discovered = await discoverPlugins(projectRoot);
	const activeByScope: Record<PluginScope, Map<string, DiscoveredPlugin>> = {
		global: new Map(),
		project: new Map(),
	};
	for (const scope of ['global', 'project'] as const) {
		for (const plugin of discovered[scope].plugins) {
			if (!plugin.enabled || plugin.status !== 'installed' || !plugin.manifest)
				continue;
			activeByScope[scope].set(plugin.name, plugin);
		}
	}

	for (const scope of ['global', 'project'] as const) {
		const scopeProjectRoot = scope === 'project' ? projectRoot : undefined;
		await removeOrphanedPluginSkills(
			activeByScope[scope],
			scope,
			scopeProjectRoot,
		);
		for (const plugin of activeByScope[scope].values()) {
			if (!plugin.manifest) continue;
			await syncPluginSkillsToAgentsDir(
				plugin.dir,
				plugin.manifest,
				scope,
				scopeProjectRoot,
			);
		}
	}
}

async function removeOrphanedPluginSkills(
	activePlugins: Map<string, DiscoveredPlugin>,
	scope: PluginScope,
	projectRoot?: string,
): Promise<void> {
	const skillsDir = getAgentsSkillsDir(scope, projectRoot);
	let entries: Dirent<string>[];
	try {
		entries = await readdir(skillsDir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const dir = joinPath(skillsDir, entry.name);
		const marker = Bun.file(joinPath(dir, PLUGIN_SKILL_MARKER_FILE));
		let owner: string;
		try {
			if (!(await marker.exists())) continue;
			owner = (await marker.text()).trim();
		} catch {
			continue;
		}
		if (activePlugins.has(owner)) continue;
		await rm(dir, { recursive: true, force: true });
	}
	await removeDirIfEmpty(skillsDir);
}

/** Materialize plugin skills into .agents/skills so any harness can use them. */
export async function syncPluginSkillsToAgentsDir(
	pluginDir: string,
	manifest: PluginManifest,
	scope: PluginScope,
	projectRoot?: string,
): Promise<void> {
	await removeSyncedPluginSkills(manifest.name, scope, projectRoot);
	if (!manifest.skills?.length) return;

	const skillsDir = getAgentsSkillsDir(scope, projectRoot);
	const normalizedPluginDir = normalizeSourcePattern(pluginDir);
	for (const skill of manifest.skills) {
		if (!skill.path) continue;
		const normalizedSkillPath = normalizeSourcePattern(skill.path);
		if (normalizedSkillPath.split('/').includes('..')) continue;

		const skillFile = joinPath(pluginDir, normalizedSkillPath);
		if (!(await fileExists(skillFile))) continue;

		const sourceDir = parentPath(skillFile);
		const targetDir = joinPath(skillsDir, skill.name);
		await rm(targetDir, { recursive: true, force: true });
		await ensureDir(targetDir);
		const skillFileName = skillFile.slice(skillFile.lastIndexOf('/') + 1);
		const targetSkillFile = joinPath(targetDir, 'SKILL.md');
		if (normalizeSourcePattern(sourceDir) === normalizedPluginDir) {
			await cp(skillFile, targetSkillFile, { force: true });
		} else {
			await cp(sourceDir, targetDir, { recursive: true, force: true });
			if (skillFileName !== 'SKILL.md') {
				await cp(joinPath(targetDir, skillFileName), targetSkillFile, {
					force: true,
				});
				await rm(joinPath(targetDir, skillFileName), { force: true });
			}
		}
		try {
			const content = await Bun.file(targetSkillFile).text();
			await Bun.write(
				targetSkillFile,
				normalizeSkillFrontmatter(content, skill.name, skill.description),
			);
		} catch {}
		await Bun.write(
			joinPath(targetDir, PLUGIN_SKILL_MARKER_FILE),
			`${manifest.name}\n`,
		);
	}
}
