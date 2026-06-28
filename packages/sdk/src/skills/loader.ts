import { join, dirname, resolve, sep } from 'node:path';
import { promises as fs } from 'node:fs';
import fg from 'fast-glob';
import { parseSkillFile } from './parser.ts';
import type {
	SkillDefinition,
	DiscoveredSkill,
	SkillScope,
	SkillFileInfo,
} from './types.ts';
import { getGlobalConfigDir, getHomeDir } from '../config/src/paths.ts';
import { resolveEffectivePlugins } from '../plugins/index.ts';

const skillCache = new Map<string, SkillDefinition>();

const ALLOWED_EXTENSIONS = new Set([
	'.md',
	'.txt',
	'.json',
	'.yaml',
	'.yml',
	'.toml',
	'.ts',
	'.js',
	'.tsx',
	'.jsx',
	'.py',
	'.rs',
	'.go',
	'.sh',
	'.bash',
	'.zsh',
	'.css',
	'.html',
	'.xml',
	'.svg',
]);

const MAX_FILE_SIZE = 256 * 1024;

export async function discoverSkills(
	cwd: string,
	repoRoot?: string,
): Promise<DiscoveredSkill[]> {
	const skills = new Map<string, SkillDefinition>();
	const home = getHomeDir();

	const globalDirs = [
		join(getGlobalConfigDir(), 'skills'),
		join(home, '.agents/skills'),
		join(home, '.claude/skills'),
		join(home, '.codex/skills'),
	];
	for (const dir of globalDirs) {
		await loadSkillsFromDir(dir, 'user', skills);
	}
	await loadSkillsFromPlugins(repoRoot ?? cwd, 'global', 'user', skills);

	const projectDirs = [
		join(cwd, '.otto/skills'),
		join(cwd, '.agents/skills'),
		join(cwd, '.claude/skills'),
		join(cwd, '.codex/skills'),
	];
	for (const dir of projectDirs) {
		await loadSkillsFromDir(dir, 'cwd', skills);
	}

	if (repoRoot && repoRoot !== cwd) {
		const repoDirs = [
			join(repoRoot, '.otto/skills'),
			join(repoRoot, '.agents/skills'),
			join(repoRoot, '.claude/skills'),
			join(repoRoot, '.codex/skills'),
		];
		for (const dir of repoDirs) {
			await loadSkillsFromDir(dir, 'repo', skills);
		}
	}
	await loadSkillsFromPlugins(repoRoot ?? cwd, 'project', 'repo', skills);

	skillCache.clear();
	for (const [name, def] of skills) {
		skillCache.set(name, def);
	}

	return Array.from(skills.values()).map((s) => ({
		name: s.metadata.name,
		description: s.metadata.description,
		path: s.path,
		scope: s.scope,
	}));
}

export async function loadSkill(name: string): Promise<SkillDefinition | null> {
	return skillCache.get(name) ?? null;
}

export async function loadSkillFile(
	name: string,
	filePath: string,
): Promise<{ content: string; resolvedPath: string } | null> {
	const skill = skillCache.get(name);
	if (!skill) return null;

	const skillDir = resolve(dirname(skill.path));
	const resolved = resolve(skillDir, filePath);

	if (resolved !== skillDir && !resolved.startsWith(`${skillDir}${sep}`)) {
		return null;
	}

	const ext = `.${resolved.split('.').pop()?.toLowerCase()}`;
	if (!ALLOWED_EXTENSIONS.has(ext)) {
		return null;
	}

	try {
		const stat = await fs.stat(resolved);
		if (stat.size > MAX_FILE_SIZE) {
			return null;
		}
		const content = await fs.readFile(resolved, 'utf-8');
		return { content, resolvedPath: resolved };
	} catch {
		return null;
	}
}

export async function discoverSkillFiles(
	name: string,
): Promise<SkillFileInfo[]> {
	const skill = skillCache.get(name);
	if (!skill) return [];

	const skillDir = dirname(skill.path);
	try {
		const files = await fg('**/*', {
			cwd: skillDir,
			absolute: false,
			ignore: ['SKILL.md', 'node_modules/**', '.git/**'],
			onlyFiles: true,
		});

		const results: SkillFileInfo[] = [];
		for (const f of files.sort()) {
			const ext = `.${f.split('.').pop()?.toLowerCase()}`;
			if (!ALLOWED_EXTENSIONS.has(ext)) continue;

			try {
				const stat = await fs.stat(join(skillDir, f));
				results.push({ relativePath: f, size: stat.size });
			} catch {}
		}
		return results;
	} catch {
		return [];
	}
}

export function getSkillCache(): Map<string, SkillDefinition> {
	return skillCache;
}

export function clearSkillCache(): void {
	skillCache.clear();
}

async function loadSkillsFromDir(
	dir: string,
	scope: SkillScope,
	skills: Map<string, SkillDefinition>,
): Promise<void> {
	try {
		await fs.access(dir);
	} catch {
		return;
	}

	const pattern = '**/SKILL.md';
	let files: string[];
	try {
		files = await fg(pattern, { cwd: dir, absolute: true });
	} catch {
		return;
	}

	for (const filePath of files) {
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			const skill = parseSkillFile(content, filePath, scope);

			const dirName = dirname(filePath).split(/[\\/]/).pop();
			void dirName;

			skills.set(skill.metadata.name, skill);
		} catch {}
	}
}

async function loadSkillsFromPlugins(
	projectRoot: string,
	pluginScope: 'global' | 'project',
	skillScope: SkillScope,
	skills: Map<string, SkillDefinition>,
): Promise<void> {
	let effectivePlugins: Awaited<ReturnType<typeof resolveEffectivePlugins>>;
	try {
		effectivePlugins = await resolveEffectivePlugins(projectRoot);
	} catch {
		return;
	}

	for (const plugin of effectivePlugins.plugins) {
		if (plugin.scope !== pluginScope) continue;
		if (
			!plugin.enabled ||
			plugin.status !== 'installed' ||
			!plugin.manifest?.skills
		)
			continue;

		for (const pluginSkill of plugin.manifest.skills) {
			if (!pluginSkill.path) continue;
			try {
				const skillPath = resolve(plugin.dir, pluginSkill.path);
				const pluginDir = resolve(plugin.dir);
				if (!skillPath.startsWith(`${pluginDir}/`) && skillPath !== pluginDir)
					continue;

				const content = await fs.readFile(skillPath, 'utf-8');
				const skill = parseSkillFile(content, skillPath, skillScope);
				if (pluginSkill.description) {
					skill.metadata.description = pluginSkill.description;
				}
				skills.set(skill.metadata.name, skill);
			} catch {}
		}
	}
}

export async function findGitRoot(startDir: string): Promise<string | null> {
	let current = startDir;
	const visited = new Set<string>();

	while (current && !visited.has(current)) {
		visited.add(current);
		try {
			await fs.access(join(current, '.git'));
			return current;
		} catch {
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
	}

	return null;
}

export async function listSkillsInDir(dir: string): Promise<string[]> {
	try {
		await fs.access(dir);
	} catch {
		return [];
	}

	const pattern = '**/SKILL.md';
	const files = await fg(pattern, { cwd: dir, absolute: false });

	return files.map((f) => dirname(f));
}
