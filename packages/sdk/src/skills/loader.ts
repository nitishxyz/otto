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
import { listSuppressedPluginSkillDirs } from '../plugins/skills.ts';

export type SkillRegistry = ReadonlyMap<string, SkillDefinition>;
const registries = new WeakMap<DiscoveredSkill[], SkillRegistry>();
const registryLists = new WeakMap<SkillRegistry, DiscoveredSkill[]>();

export function getRegistrySkills(registry = skillCache): DiscoveredSkill[] {
	return registryLists.get(registry) ?? [];
}
let skillCache: SkillRegistry = new Map();

/** A discovery result owns its definitions; the latest result is a legacy default only. */
export function getSkillRegistry(skills?: DiscoveredSkill[]): SkillRegistry {
	return skills ? (registries.get(skills) ?? new Map()) : skillCache;
}

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
	const suppressed = await Promise.all(
		(await listSuppressedPluginSkillDirs(cwd)).map(async (dir) =>
			fs.realpath(dir).catch(() => resolve(dir)),
		),
	);

	const globalDirs = [
		join(getGlobalConfigDir(), 'skills'),
		join(home, '.agents/skills'),
		join(home, '.claude/skills'),
		join(home, '.codex/skills'),
	];
	for (const dir of globalDirs) {
		await loadSkillsFromDir(dir, 'user', skills, suppressed);
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

	// Higher scopes overwrite lower scopes: cwd > repo > user.
	for (const dir of [
		'.otto/skills',
		'.agents/skills',
		'.claude/skills',
		'.codex/skills',
	]) {
		await loadSkillsFromDir(join(cwd, dir), 'cwd', skills);
	}
	for (const def of skills.values()) {
		Object.freeze(def.metadata.allowedTools);
		Object.freeze(def.metadata.metadata);
		Object.freeze(def.metadata);
		Object.freeze(def);
	}
	const registry: SkillRegistry = Object.freeze({
		get size() {
			return skills.size;
		},
		get: skills.get.bind(skills),
		has: skills.has.bind(skills),
		entries: skills.entries.bind(skills),
		keys: skills.keys.bind(skills),
		values: skills.values.bind(skills),
		forEach(
			callback: (
				value: SkillDefinition,
				key: string,
				map: SkillRegistry,
			) => void,
			thisArg?: unknown,
		) {
			for (const [name, skill] of skills)
				callback.call(thisArg, skill, name, registry);
		},
		[Symbol.iterator]: skills[Symbol.iterator].bind(skills),
	});
	skillCache = registry;
	const discovered = Array.from(skills.values()).map((s) => ({
		name: s.metadata.name,
		description: s.metadata.description,
		path: s.path,
		scope: s.scope,
	}));
	registries.set(discovered, registry);
	registryLists.set(registry, discovered);
	return discovered;
}

export async function loadSkill(
	name: string,
	source: SkillRegistry | DiscoveredSkill[] = skillCache,
): Promise<SkillDefinition | null> {
	const registry = Array.isArray(source) ? getSkillRegistry(source) : source;
	return registry.get(name) ?? null;
}

export async function loadSkillFile(
	name: string,
	filePath: string,
	registry = skillCache,
): Promise<{ content: string; resolvedPath: string } | null> {
	const skill = registry.get(name);
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
		const canonicalDir = await fs.realpath(skillDir);
		const canonicalFile = await fs.realpath(resolved);
		if (!canonicalFile.startsWith(`${canonicalDir}${sep}`)) return null;
		const stat = await fs.stat(canonicalFile);
		if (stat.size > MAX_FILE_SIZE) {
			return null;
		}
		const content = await fs.readFile(canonicalFile, 'utf-8');
		return { content, resolvedPath: canonicalFile };
	} catch {
		return null;
	}
}

export async function discoverSkillFiles(
	name: string,
	source: SkillRegistry | DiscoveredSkill[] = skillCache,
): Promise<SkillFileInfo[]> {
	const registry = Array.isArray(source) ? getSkillRegistry(source) : source;
	const skill = registry.get(name);
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
				const file = await loadSkillFile(name, f, registry);
				if (!file) continue;
				const stat = await fs.stat(file.resolvedPath);
				results.push({ relativePath: f, size: stat.size });
			} catch {}
		}
		return results;
	} catch {
		return [];
	}
}

export function getSkillCache(): Map<string, SkillDefinition> {
	return new Map(skillCache);
}

export function clearSkillCache(): void {
	skillCache = new Map();
}

async function loadSkillsFromDir(
	dir: string,
	scope: SkillScope,
	skills: Map<string, SkillDefinition>,
	suppressed: readonly string[] = [],
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
			if (suppressed.length) {
				const canonical = await fs.realpath(filePath);
				if (
					suppressed.some(
						(dir) => canonical === dir || canonical.startsWith(`${dir}${sep}`),
					)
				)
					continue;
			}
			const content = await fs.readFile(filePath, 'utf-8');
			const skill = parseSkillFile(content, filePath, scope);

			const dirName = dirname(filePath).split(/[\\/]/).pop();
			void dirName;

			skills.set(skill.metadata.name, skill);
		} catch {}
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
