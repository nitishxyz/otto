import { cp, readdir, rename, rmdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import {
	ensureDir,
	fileExists,
	getGlobalAgentsSkillsDir,
	getProjectAgentsSkillsDir,
	joinPath,
} from '../config/src/paths.ts';
import { normalizeSkillFrontmatter } from '../skills/frontmatter.ts';
import { discoverPlugins, resolveEffectivePlugins } from './discovery.ts';
import { removeDescendantPath } from './fs-safety.ts';
import { normalizeSourcePattern } from './source.ts';
import { pluginNameSchema } from './schema.ts';
import type {
	DiscoveredPlugin,
	PluginManifest,
	PluginScope,
} from './schema.ts';

const PLUGIN_SKILL_MARKER_FILE = '.otto-plugin';

export type PluginSkillSyncResult = {
	synced: string[];
	/** Skill names skipped because the target directory is owned by someone else. */
	conflicts: Array<{ skill: string; owner: string | null }>;
};

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

type SkillDirOwnership =
	| { kind: 'absent' }
	| { kind: 'unowned' }
	| { kind: 'plugin'; owner: string };

async function readSkillDirOwnership(dir: string): Promise<SkillDirOwnership> {
	if (!(await directoryExists(dir))) return { kind: 'absent' };
	const marker = Bun.file(joinPath(dir, PLUGIN_SKILL_MARKER_FILE));
	try {
		if (!(await marker.exists())) return { kind: 'unowned' };
		const owner = (await marker.text()).trim();
		return owner ? { kind: 'plugin', owner } : { kind: 'unowned' };
	} catch {
		return { kind: 'unowned' };
	}
}

async function directoryExists(dir: string): Promise<boolean> {
	try {
		await readdir(dir);
		return true;
	} catch {
		return false;
	}
}

async function listSkillDirs(skillsDir: string): Promise<Dirent<string>[]> {
	try {
		return (await readdir(skillsDir, { withFileTypes: true })).filter((entry) =>
			entry.isDirectory(),
		);
	} catch {
		return [];
	}
}

/** Remove skills previously synced into .agents/skills for a plugin. */
export async function removeSyncedPluginSkills(
	pluginName: string,
	scope: PluginScope,
	projectRoot?: string,
	keep: ReadonlySet<string> = new Set(),
): Promise<void> {
	const skillsDir = getAgentsSkillsDir(scope, projectRoot);
	for (const entry of await listSkillDirs(skillsDir)) {
		if (keep.has(entry.name)) continue;
		const dir = joinPath(skillsDir, entry.name);
		const ownership = await readSkillDirOwnership(dir);
		if (ownership.kind !== 'plugin' || ownership.owner !== pluginName) continue;
		await removeDescendantPath(skillsDir, dir);
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
 * Directories without an otto plugin marker are never touched.
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

/**
 * Lists globally synced skill directories that must be hidden for this
 * project because their owning global plugin is effectively disabled here
 * (for example by a project-level disable override).
 */
export async function listSuppressedPluginSkillDirs(
	projectRoot: string,
): Promise<string[]> {
	const effective = await resolveEffectivePlugins(projectRoot);
	const suppressedOwners = new Set(
		effective.plugins
			.filter((plugin) => !plugin.enabled)
			.map((plugin) => plugin.name),
	);
	if (!suppressedOwners.size) return [];
	const skillsDir = getGlobalAgentsSkillsDir();
	const suppressed: string[] = [];
	for (const entry of await listSkillDirs(skillsDir)) {
		const dir = joinPath(skillsDir, entry.name);
		const ownership = await readSkillDirOwnership(dir);
		if (ownership.kind === 'plugin' && suppressedOwners.has(ownership.owner)) {
			suppressed.push(dir);
		}
	}
	return suppressed;
}

async function removeOrphanedPluginSkills(
	activePlugins: Map<string, DiscoveredPlugin>,
	scope: PluginScope,
	projectRoot?: string,
): Promise<void> {
	const skillsDir = getAgentsSkillsDir(scope, projectRoot);
	for (const entry of await listSkillDirs(skillsDir)) {
		const dir = joinPath(skillsDir, entry.name);
		const ownership = await readSkillDirOwnership(dir);
		if (ownership.kind !== 'plugin') continue;
		if (activePlugins.has(ownership.owner)) continue;
		await removeDescendantPath(skillsDir, dir);
	}
	await removeDirIfEmpty(skillsDir);
}

async function stageSkill(
	pluginDir: string,
	skillFile: string,
	stagedDir: string,
	skill: { name: string; description?: string },
	owner: string,
): Promise<void> {
	const normalizedPluginDir = normalizeSourcePattern(pluginDir);
	const sourceDir = parentPath(skillFile);
	const skillFileName = skillFile.slice(skillFile.lastIndexOf('/') + 1);
	const targetSkillFile = joinPath(stagedDir, 'SKILL.md');
	await ensureDir(stagedDir);
	if (normalizeSourcePattern(sourceDir) === normalizedPluginDir) {
		await cp(skillFile, targetSkillFile, { force: true });
	} else {
		await cp(sourceDir, stagedDir, { recursive: true, force: true });
		if (skillFileName !== 'SKILL.md') {
			await cp(joinPath(stagedDir, skillFileName), targetSkillFile, {
				force: true,
			});
			await removeDescendantPath(stagedDir, joinPath(stagedDir, skillFileName));
		}
	}
	try {
		const content = await Bun.file(targetSkillFile).text();
		await Bun.write(
			targetSkillFile,
			normalizeSkillFrontmatter(content, skill.name, skill.description),
		);
	} catch {}
	await Bun.write(joinPath(stagedDir, PLUGIN_SKILL_MARKER_FILE), `${owner}\n`);
}

/**
 * Materialize plugin skills into .agents/skills so any harness can use them.
 * Ownership is resolved before mutation: directories that are user-authored
 * (no marker) or owned by another plugin are reported as conflicts and never
 * replaced. Owned skills are staged and swapped in.
 */
export async function syncPluginSkillsToAgentsDir(
	pluginDir: string,
	manifest: PluginManifest,
	scope: PluginScope,
	projectRoot?: string,
): Promise<PluginSkillSyncResult> {
	const result: PluginSkillSyncResult = { synced: [], conflicts: [] };
	const skillsDir = getAgentsSkillsDir(scope, projectRoot);

	type PlannedSkill = {
		skill: NonNullable<PluginManifest['skills']>[number];
		skillFile: string;
		targetDir: string;
	};
	const planned: PlannedSkill[] = [];
	for (const skill of manifest.skills ?? []) {
		if (!skill.path) continue;
		if (!pluginNameSchema.safeParse(skill.name).success) continue;
		const normalizedSkillPath = normalizeSourcePattern(skill.path);
		if (normalizedSkillPath.split('/').includes('..')) continue;
		const skillFile = joinPath(pluginDir, normalizedSkillPath);
		if (!(await fileExists(skillFile))) continue;
		const targetDir = joinPath(skillsDir, skill.name);
		const ownership = await readSkillDirOwnership(targetDir);
		if (ownership.kind === 'unowned') {
			result.conflicts.push({ skill: skill.name, owner: null });
			continue;
		}
		if (ownership.kind === 'plugin' && ownership.owner !== manifest.name) {
			result.conflicts.push({ skill: skill.name, owner: ownership.owner });
			continue;
		}
		planned.push({ skill, skillFile, targetDir });
	}

	await removeSyncedPluginSkills(
		manifest.name,
		scope,
		projectRoot,
		new Set(planned.map((item) => item.skill.name)),
	);
	if (!planned.length) return result;

	await ensureDir(skillsDir);
	const stagingRoot = joinPath(parentPath(skillsDir), '.otto-skill-staging');
	await ensureDir(stagingRoot);
	try {
		for (const item of planned) {
			const stagedDir = joinPath(stagingRoot, crypto.randomUUID());
			try {
				await stageSkill(
					pluginDir,
					item.skillFile,
					stagedDir,
					item.skill,
					manifest.name,
				);
				const current = await readSkillDirOwnership(item.targetDir);
				if (
					current.kind === 'unowned' ||
					(current.kind === 'plugin' && current.owner !== manifest.name)
				) {
					result.conflicts.push({
						skill: item.skill.name,
						owner: current.kind === 'plugin' ? current.owner : null,
					});
					continue;
				}
				if (current.kind === 'plugin') {
					await removeDescendantPath(skillsDir, item.targetDir);
				}
				await rename(stagedDir, item.targetDir);
				result.synced.push(item.skill.name);
			} finally {
				await removeDescendantPath(stagingRoot, stagedDir);
			}
		}
	} finally {
		await removeDirIfEmpty(stagingRoot);
	}
	return result;
}
