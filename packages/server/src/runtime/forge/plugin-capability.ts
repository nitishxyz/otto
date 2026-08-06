import {
	parseSkillFile,
	pluginManifestSchema,
	syncPluginSkills,
	type PluginManifest,
} from '@ottocode/sdk';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { parseRecipeContent } from '../commands/recipes.ts';
import type { ForgeInput, ForgePlan, ForgeScope } from './types.ts';
import {
	assertForgePluginMutable,
	atomicWriteForgeJson,
	resetForgePluginRuntime,
	resolveForgePlugin,
} from './plugin.ts';

type PluginCapabilityKind = 'recipe' | 'skill' | 'agent';

function capabilityName(input: ForgeInput): string {
	const name = input.name?.trim().toLowerCase();
	if (!name) throw new Error('name is required');
	return name;
}

function resolvePluginPath(pluginDir: string, relativePath: string): string {
	const root = resolve(pluginDir);
	const path = resolve(root, relativePath);
	if (path !== root && !path.startsWith(`${root}${sep}`)) {
		throw new Error(
			`Capability path escapes plugin directory: ${relativePath}`,
		);
	}
	return path;
}

function quote(value: string): string {
	return JSON.stringify(value);
}

function buildRecipeFile(
	input: ForgeInput,
	existingRaw: string | null,
): string {
	const existing = existingRaw ? parseRecipeContent(existingRaw) : undefined;
	const content = (input.content ?? existing?.instructions)?.trim();
	if (!content) throw new Error('content is required for a plugin recipe');
	const lines = ['---'];
	const description = input.description ?? existing?.description;
	if (description) lines.push(`description: ${quote(description)}`);
	lines.push(
		`agent: ${quote(input.recipeAgent ?? existing?.agent ?? 'build')}`,
		`includeInHistory: ${input.includeInHistory ?? existing?.includeInHistory ?? true}`,
		`oneShot: ${input.oneShot ?? existing?.oneShot ?? false}`,
		'---',
		'',
		content,
		'',
	);
	return lines.join('\n');
}

function buildSkillFile(
	input: ForgeInput,
	name: string,
	existingRaw: string | null,
): string {
	const existing = existingRaw
		? parseSkillFile(existingRaw, 'SKILL.md', 'cwd')
		: undefined;
	const description = input.description ?? existing?.metadata.description;
	if (!description)
		throw new Error('description is required for a plugin skill');
	const content = (input.content ?? existing?.content)?.trim();
	if (!content) throw new Error('content is required for a plugin skill');
	const allowedTools = input.allowedTools ?? existing?.metadata.allowedTools;
	const lines = [
		'---',
		`name: ${quote(name)}`,
		`description: ${quote(description)}`,
	];
	if (allowedTools?.length) {
		lines.push(`allowed-tools: ${quote(allowedTools.join(' '))}`);
	}
	lines.push('---', '', content, '');
	const result = lines.join('\n');
	parseSkillFile(result, 'SKILL.md', 'cwd');
	return result;
}

function defaultPath(kind: PluginCapabilityKind, name: string): string {
	if (kind === 'recipe') return `recipes/${name}.md`;
	if (kind === 'skill') return `skills/${name}/SKILL.md`;
	return `agents/${name}.md`;
}

function findEntry(
	manifest: PluginManifest,
	kind: PluginCapabilityKind,
	name: string,
) {
	if (kind === 'recipe')
		return manifest.recipes?.find((item) => item.name === name);
	if (kind === 'skill')
		return manifest.skills?.find((item) => item.name === name);
	return manifest.agents?.find((item) => item.name === name);
}

export async function runForgePluginCapabilityAction(
	projectRoot: string,
	input: ForgeInput,
) {
	const kind = input.kind as PluginCapabilityKind;
	const pluginName = input.plugin?.trim().toLowerCase();
	if (!pluginName) throw new Error('plugin is required');
	const name = capabilityName(input);
	const scope: ForgeScope = input.scope ?? 'project';
	const plugin = await resolveForgePlugin(projectRoot, pluginName, scope);
	if (!plugin.manifest) throw new Error(`Plugin '${pluginName}' is invalid`);
	assertForgePluginMutable(plugin);
	const existing = findEntry(plugin.manifest, kind, name);
	const action = input.action === 'plan' ? input.targetAction : input.action;
	if (!action || !['create', 'update', 'remove'].includes(action)) {
		throw new Error(
			`Action '${input.action}' is not supported for plugin ${kind}`,
		);
	}
	if (action === 'create' && existing) {
		throw new Error(
			`Plugin ${kind} '${pluginName}/${name}' already exists; use update`,
		);
	}
	if ((action === 'update' || action === 'remove') && !existing) {
		throw new Error(`Plugin ${kind} '${pluginName}/${name}' not found`);
	}

	const relativePath =
		('path' in (existing ?? {}) && typeof existing?.path === 'string'
			? existing.path
			: undefined) ?? defaultPath(kind, name);
	const filePath = resolvePluginPath(plugin.dir, relativePath);
	const existingRaw = await readFile(filePath, 'utf8').catch(() => null);
	const nextContent =
		action === 'remove'
			? undefined
			: kind === 'recipe'
				? buildRecipeFile(input, existingRaw)
				: kind === 'skill'
					? buildSkillFile(input, name, existingRaw)
					: (input.content ?? existingRaw)?.trim();
	if (action !== 'remove' && !nextContent) {
		throw new Error(`content is required for a plugin ${kind}`);
	}

	const plan: ForgePlan = {
		action: action as 'create' | 'update' | 'remove',
		target: {
			kind,
			scope,
			name: `${pluginName}/${name}`,
			paths: [plugin.manifestPath, filePath],
		},
		exists: Boolean(existing),
		changes: [`${action} ${kind} '${name}' in plugin '${pluginName}'`],
		...(nextContent ? { preview: nextContent } : {}),
	};
	if (input.action === 'plan' || input.dryRun) {
		return { ok: true, applied: false, plan };
	}

	const originalManifest = await readFile(plugin.manifestPath, 'utf8');
	const rawManifest = JSON.parse(originalManifest) as Record<string, unknown>;
	const key =
		kind === 'recipe' ? 'recipes' : kind === 'skill' ? 'skills' : 'agents';
	const entries: Array<Record<string, unknown> & { name: string }> = [
		...((plugin.manifest[key] as
			| Array<Record<string, unknown> & { name: string }>
			| undefined) ?? []),
	].filter((item) => item.name !== name);
	if (action !== 'remove') {
		if (kind === 'agent') {
			entries.push({
				name,
				path: relativePath,
				...(input.description ? { description: input.description } : {}),
				...(input.provider ? { provider: input.provider } : {}),
				...(input.model ? { model: input.model } : {}),
				...(input.tools ? { tools: input.tools } : {}),
				...(input.appendTools ? { appendTools: input.appendTools } : {}),
			});
		} else {
			entries.push({
				name,
				path: relativePath,
				...(input.description ? { description: input.description } : {}),
			});
		}
	}
	const nextManifest: Record<string, unknown> = { ...rawManifest };
	if (entries.length) nextManifest[key] = entries;
	else delete nextManifest[key];
	pluginManifestSchema.parse(nextManifest);

	try {
		if (nextContent) {
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, `${nextContent.trimEnd()}\n`, 'utf8');
		}
		await atomicWriteForgeJson(plugin.manifestPath, nextManifest);
	} catch (error) {
		await writeFile(plugin.manifestPath, originalManifest, 'utf8');
		if (existingRaw === null) await rm(filePath, { force: true });
		else await writeFile(filePath, existingRaw, 'utf8');
		throw error;
	}
	if (action === 'remove') {
		const shared = entries.some(
			(item) => 'path' in item && item.path === relativePath,
		);
		if (!shared) await rm(filePath, { force: true });
	}
	if (kind === 'skill') await syncPluginSkills(projectRoot);
	resetForgePluginRuntime(projectRoot, scope);
	return { ok: true, applied: true, plan };
}
