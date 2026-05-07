import type { Context } from 'hono';
import {
	discoverSkillFiles,
	discoverSkills,
	filterDiscoveredSkills,
	findGitRoot,
	loadConfig,
	loadSkill,
	loadSkillFile,
	logger,
	parseSkillFile,
	validateSkillName,
	writeSkillSettings,
} from '@ottocode/sdk';
import { serializeError } from '../../runtime/errors/api-error.ts';

function dedupeSkillsByName<T extends { name: string }>(skills: T[]): T[] {
	const seen = new Set<string>();
	return skills.filter((skill) => {
		const key = skill.name.trim();
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function sortSkillsByName<T extends { name: string }>(skills: T[]): T[] {
	return [...skills].sort((a, b) => a.name.localeCompare(b.name));
}

function mapSkillsWithEnabled(
	discovered: Array<{
		name: string;
		description: string;
		scope: string;
		path: string;
	}>,
	cfg: Awaited<ReturnType<typeof loadConfig>>,
) {
	return discovered.map((skill) => ({
		name: skill.name,
		description: skill.description,
		scope: skill.scope,
		path: skill.path,
		enabled: cfg.skills?.items?.[skill.name]?.enabled !== false,
	}));
}

async function loadProjectSkills(projectRoot: string) {
	const cfg = await loadConfig(projectRoot);
	const repoRoot = (await findGitRoot(projectRoot)) ?? projectRoot;
	const discovered = sortSkillsByName(
		dedupeSkillsByName(await discoverSkills(projectRoot, repoRoot)),
	);
	const filtered = sortSkillsByName(
		filterDiscoveredSkills(discovered, cfg.skills),
	);
	return { cfg, discovered, filtered };
}

async function ensureSkillsDiscovered(projectRoot: string): Promise<void> {
	const repoRoot = (await findGitRoot(projectRoot)) ?? projectRoot;
	await discoverSkills(projectRoot, repoRoot);
}

function projectRootFromQuery(c: Context): string {
	return c.req.query('project') || process.cwd();
}

function jsonError(c: Context, message: string, error: unknown) {
	logger.error(message, error);
	const errorResponse = serializeError(error);
	return c.json(errorResponse, (errorResponse.error.status || 500) as 500);
}

export async function listSkills(c: Context) {
	try {
		const projectRoot = projectRootFromQuery(c);
		const cfg = await loadConfig(projectRoot);
		const repoRoot = (await findGitRoot(projectRoot)) ?? projectRoot;
		const discovered = sortSkillsByName(
			await discoverSkills(projectRoot, repoRoot),
		);
		const filtered = filterDiscoveredSkills(discovered, cfg.skills);
		const unique = sortSkillsByName(dedupeSkillsByName(filtered));
		return c.json({
			skills: mapSkillsWithEnabled(unique, cfg),
		});
	} catch (error) {
		return jsonError(c, 'Failed to list skills', error);
	}
}

export async function getSkillsConfig(c: Context) {
	try {
		const { cfg, discovered, filtered } = await loadProjectSkills(
			projectRootFromQuery(c),
		);
		return c.json({
			enabled: cfg.skills?.enabled !== false,
			totalCount: discovered.length,
			enabledCount: filtered.length,
			items: mapSkillsWithEnabled(discovered, cfg),
		});
	} catch (error) {
		return jsonError(c, 'Failed to get skills config', error);
	}
}

export async function updateSkillsConfig(c: Context) {
	try {
		const projectRoot = projectRootFromQuery(c);
		const body = await c.req.json<{
			enabled?: boolean;
			items?: Record<string, { enabled?: boolean }>;
		}>();
		await writeSkillSettings(
			'global',
			{
				...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
				...(body.items ? { items: body.items } : {}),
			},
			projectRoot,
		);

		const { cfg, discovered, filtered } = await loadProjectSkills(projectRoot);
		return c.json({
			success: true,
			enabled: cfg.skills?.enabled !== false,
			totalCount: discovered.length,
			enabledCount: filtered.length,
			items: mapSkillsWithEnabled(discovered, cfg),
		});
	} catch (error) {
		return jsonError(c, 'Failed to update skills config', error);
	}
}

export async function getSkill(c: Context) {
	try {
		const name = c.req.param('name');
		await ensureSkillsDiscovered(projectRootFromQuery(c));

		const skill = await loadSkill(name);
		if (!skill) {
			return c.json({ error: `Skill '${name}' not found` }, 404);
		}

		return c.json({
			name: skill.metadata.name,
			description: skill.metadata.description,
			license: skill.metadata.license ?? null,
			compatibility: skill.metadata.compatibility ?? null,
			metadata: skill.metadata.metadata ?? null,
			allowedTools: skill.metadata.allowedTools ?? null,
			path: skill.path,
			scope: skill.scope,
			content: skill.content,
		});
	} catch (error) {
		return jsonError(c, 'Failed to load skill', error);
	}
}

export async function listSkillFiles(c: Context) {
	try {
		const name = c.req.param('name');
		await ensureSkillsDiscovered(projectRootFromQuery(c));
		const files = await discoverSkillFiles(name);
		return c.json({ files });
	} catch (error) {
		return jsonError(c, 'Failed to list skill files', error);
	}
}

export async function getSkillFile(c: Context) {
	try {
		const name = c.req.param('name');
		const filePath = c.req.path.replace(`/v1/skills/${name}/files/`, '');
		await ensureSkillsDiscovered(projectRootFromQuery(c));

		const result = await loadSkillFile(name, filePath);
		if (!result) {
			return c.json(
				{ error: `File '${filePath}' not found in skill '${name}'` },
				404,
			);
		}
		return c.json({ content: result.content, path: result.resolvedPath });
	} catch (error) {
		return jsonError(c, 'Failed to load skill file', error);
	}
}

export async function validateSkill(c: Context) {
	try {
		const body = await c.req.json<{ content: string; path?: string }>();
		if (!body.content) {
			return c.json({ error: 'content is required' }, 400);
		}

		const skillPath = body.path ?? 'SKILL.md';
		const skill = parseSkillFile(body.content, skillPath, 'cwd');
		return c.json({
			valid: true,
			name: skill.metadata.name,
			description: skill.metadata.description,
			license: skill.metadata.license ?? null,
		});
	} catch (error) {
		return c.json({
			valid: false,
			error: (error as Error).message,
		});
	}
}

export function validateSkillNameRoute(c: Context) {
	const name = c.req.param('name');
	return c.json({ valid: validateSkillName(name) });
}
