import { cp, readdir, rm } from 'node:fs/promises';
import { z } from 'zod/v3';
import { ensureDir, fileExists, joinPath } from '../config/src/paths.ts';
import { pluginManifestSchema } from './schema.ts';
import type {
	PluginManifest,
	PluginRegistryEntry,
	PluginSource,
} from './schema.ts';

export const DEFAULT_PLUGIN_REGISTRY_URL =
	'https://raw.githubusercontent.com/nitishxyz/otto/main/packages/plugin-registry/registry.json';

export function isLocalSource(source: string): boolean {
	return (
		source.startsWith('.') ||
		source.startsWith('/') ||
		source.startsWith('~') ||
		source.startsWith('file:')
	);
}

export function normalizeLocalSource(source: string): string {
	if (source.startsWith('file://')) return new URL(source).pathname;
	if (source === '~') return process.env.HOME ?? source;
	if (source.startsWith('~/'))
		return joinPath(process.env.HOME ?? '~', source.slice(2));
	return source;
}

export async function readPluginManifestFromDir(
	dir: string,
): Promise<PluginManifest> {
	const parsed = JSON.parse(
		await Bun.file(joinPath(dir, 'otto.plugin.json')).text(),
	);
	return pluginManifestSchema.parse(parsed);
}

export async function copyPluginDir(
	sourceDir: string,
	targetDir: string,
): Promise<void> {
	await rm(targetDir, { recursive: true, force: true });
	await ensureDir(targetDir.slice(0, targetDir.lastIndexOf('/')));
	await cp(sourceDir, targetDir, { recursive: true, force: true });
}

function getLocalRegistryDirectory(registryUrl: string): string | null {
	if (!isLocalSource(registryUrl)) return null;
	const normalized = normalizeLocalSource(registryUrl);
	if (normalized.endsWith('/registry.json')) {
		return normalized.slice(0, -'/registry.json'.length);
	}
	const lastSlash = normalized.lastIndexOf('/');
	return lastSlash === -1 ? '.' : normalized.slice(0, lastSlash);
}

function isAbsoluteSourcePath(path: string): boolean {
	return (
		path.startsWith('/') ||
		path.startsWith('file:') ||
		/^[A-Za-z]:[\\/]/.test(path)
	);
}

function resolveRegistrySourcePath(
	sourcePath: string,
	localRegistryDir: string | null,
): string {
	if (isAbsoluteSourcePath(sourcePath) || sourcePath.startsWith('~')) {
		return normalizeLocalSource(sourcePath);
	}
	if (localRegistryDir) {
		return joinPath(localRegistryDir, sourcePath);
	}
	return sourcePath;
}

function resolveLocalRegistryGithubPayloadDir(
	entry: PluginRegistryEntry,
	source: Extract<PluginSource, { type: 'github' }>,
	localRegistryDir: string,
): string {
	const registryPrefix = 'packages/plugin-registry/';
	if (source.path.startsWith(registryPrefix)) {
		return joinPath(localRegistryDir, source.path.slice(registryPrefix.length));
	}
	return joinPath(localRegistryDir, 'official', entry.name);
}

export async function installRegistryEntryPayload(
	entry: PluginRegistryEntry,
	targetDir: string,
	fetchImpl?: typeof fetch,
	registryUrl?: string,
): Promise<void> {
	const localRegistryDir = registryUrl
		? getLocalRegistryDirectory(registryUrl)
		: null;

	if (!entry.source) {
		await writeRegistryEntryPayload(entry, targetDir);
		return;
	}

	if (entry.source.type === 'local') {
		const sourcePath = resolveRegistrySourcePath(
			entry.source.path,
			localRegistryDir,
		);
		await copyPluginDir(sourcePath, targetDir);
		return;
	}

	if (entry.source.type === 'github' && localRegistryDir) {
		const localPayloadDir = resolveLocalRegistryGithubPayloadDir(
			entry,
			entry.source,
			localRegistryDir,
		);
		if (await fileExists(joinPath(localPayloadDir, 'otto.plugin.json'))) {
			await copyPluginDir(localPayloadDir, targetDir);
			return;
		}
	}

	await rm(targetDir, { recursive: true, force: true });
	await ensureDir(targetDir);
	await downloadGithubPath(entry.source, targetDir, fetchImpl ?? fetch);
}

async function writeRegistryEntryPayload(
	entry: PluginRegistryEntry,
	targetDir: string,
): Promise<void> {
	const { official: _official, source: _source, ...manifest } = entry;
	await rm(targetDir, { recursive: true, force: true });
	await ensureDir(targetDir);
	await Bun.write(
		joinPath(targetDir, 'otto.plugin.json'),
		`${JSON.stringify(pluginManifestSchema.parse(manifest), null, 2)}\n`,
	);
}

export async function materializePluginSkillSources(
	pluginDir: string,
	manifest: PluginManifest,
	fetchImpl?: typeof fetch,
): Promise<PluginManifest> {
	if (!manifest.skills?.length) return manifest;

	let changed = false;
	const skills: PluginManifest['skills'] = [];
	for (const skill of manifest.skills) {
		if (skill.path || !skill.source) {
			skills.push(skill);
			continue;
		}

		const skillDir = joinPath(pluginDir, 'skills', skill.name);
		await installSkillSourcePayload(skill.source, skillDir, fetchImpl ?? fetch);
		skills.push({
			...skill,
			path: `skills/${skill.name}/SKILL.md`,
		});
		changed = true;
	}

	if (!changed) return manifest;

	const updated = pluginManifestSchema.parse({
		...manifest,
		skills,
	});
	await Bun.write(
		joinPath(pluginDir, 'otto.plugin.json'),
		`${JSON.stringify(updated, null, 2)}\n`,
	);
	return updated;
}

async function installSkillSourcePayload(
	source: PluginSource,
	targetDir: string,
	fetchImpl: typeof fetch,
): Promise<void> {
	await rm(targetDir, { recursive: true, force: true });
	await ensureDir(targetDir);

	if (source.type === 'local') {
		if (source.include?.length) {
			await copyIncludedLocalSource(
				source.path,
				targetDir,
				source.include,
				source.exclude,
			);
			return;
		}

		await cp(source.path, targetDir, { recursive: true, force: true });
		await removeExcludedSourcePaths(targetDir, source.exclude);
		return;
	}

	if (source.type === 'url') {
		const response = await fetchImpl(source.url);
		if (!response.ok) {
			throw new Error(`Failed to fetch plugin skill ${source.url}`);
		}
		await Bun.write(joinPath(targetDir, 'SKILL.md'), await response.text());
		return;
	}

	await downloadGithubPath(source, targetDir, fetchImpl, {
		include: source.include,
		exclude: source.exclude,
		rootPath: source.path,
	});
}

type DownloadGithubOptions = {
	include?: string[];
	exclude?: string[];
	rootPath: string;
};

async function downloadGithubPath(
	source: Extract<PluginSource, { type: 'github' }>,
	targetDir: string,
	fetchImpl: typeof fetch,
	options: DownloadGithubOptions = { rootPath: source.path },
): Promise<void> {
	const ref = source.ref ?? 'main';
	const apiUrl = `https://api.github.com/repos/${source.repo}/contents/${source.path}?ref=${encodeURIComponent(ref)}`;
	const response = await fetchImpl(apiUrl, {
		headers: { Accept: 'application/vnd.github+json' },
	});
	if (!response.ok) {
		throw new Error(
			`Failed to fetch plugin payload ${source.repo}/${source.path}`,
		);
	}
	const payload = await response.json();
	const githubEntrySchema = z.object({
		name: z.string(),
		path: z.string(),
		type: z.enum(['file', 'dir']),
		download_url: z.string().nullable().optional(),
	});

	if (!Array.isArray(payload)) {
		const entry = githubEntrySchema.parse(payload);
		const relativePath = githubRelativePath(entry.path, options.rootPath);
		if (
			!isIncludedSourcePath(relativePath, options.include) ||
			isExcludedSourcePath(relativePath, options.exclude)
		) {
			return;
		}
		if (entry.type !== 'file' || !entry.download_url) {
			throw new Error(`Unsupported GitHub payload ${entry.path}`);
		}
		const fileResponse = await fetchImpl(entry.download_url);
		if (!fileResponse.ok) {
			throw new Error(`Failed to download plugin file ${entry.path}`);
		}
		await Bun.write(joinPath(targetDir, entry.name), await fileResponse.text());
		return;
	}

	const entries = z.array(githubEntrySchema).parse(payload);

	for (const entry of entries) {
		const relativePath = githubRelativePath(entry.path, options.rootPath);
		if (isExcludedSourcePath(relativePath, options.exclude)) continue;

		const targetPath = joinPath(targetDir, entry.name);
		if (entry.type === 'dir') {
			if (!shouldVisitSourceDirectory(relativePath, options.include)) {
				continue;
			}
			await ensureDir(targetPath);
			await downloadGithubPath(
				{ ...source, path: entry.path, ref },
				targetPath,
				fetchImpl,
				options,
			);
			continue;
		}
		if (!isIncludedSourcePath(relativePath, options.include)) continue;

		if (!entry.download_url) {
			throw new Error(`Missing download URL for ${entry.path}`);
		}
		const fileResponse = await fetchImpl(entry.download_url);
		if (!fileResponse.ok) {
			throw new Error(`Failed to download plugin file ${entry.path}`);
		}
		await Bun.write(targetPath, await fileResponse.text());
	}
}

async function copyIncludedLocalSource(
	sourceDir: string,
	targetDir: string,
	include: string[],
	exclude: string[] | undefined,
	relativeDir = '',
): Promise<void> {
	for (const entry of await readdir(joinPath(sourceDir, relativeDir), {
		withFileTypes: true,
	})) {
		const relativePath = relativeDir
			? `${relativeDir}/${entry.name}`
			: entry.name;
		if (isExcludedSourcePath(relativePath, exclude)) continue;

		if (entry.isDirectory()) {
			if (shouldVisitSourceDirectory(relativePath, include)) {
				await copyIncludedLocalSource(
					sourceDir,
					targetDir,
					include,
					exclude,
					relativePath,
				);
			}
			continue;
		}

		if (!entry.isFile() || !isIncludedSourcePath(relativePath, include)) {
			continue;
		}

		const targetPath = joinPath(targetDir, relativePath);
		await ensureDir(targetPath.slice(0, targetPath.lastIndexOf('/')));
		await cp(joinPath(sourceDir, relativePath), targetPath, { force: true });
	}
}

async function removeExcludedSourcePaths(
	targetDir: string,
	exclude: string[] | undefined,
): Promise<void> {
	for (const pattern of exclude ?? []) {
		const normalized = normalizeSourcePattern(pattern);
		if (!normalized) continue;
		const path = normalized.endsWith('/**')
			? normalized.slice(0, -'/**'.length)
			: normalized;
		await rm(joinPath(targetDir, path), { recursive: true, force: true });
	}
}

function githubRelativePath(path: string, rootPath: string): string {
	const normalizedPath = normalizeSourcePattern(path);
	const normalizedRoot = normalizeSourcePattern(rootPath);
	if (normalizedPath === normalizedRoot) return '';
	if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
		return normalizedPath.slice(normalizedRoot.length + 1);
	}
	return normalizedPath;
}

function isExcludedSourcePath(
	path: string,
	exclude: string[] | undefined,
): boolean {
	const normalizedPath = normalizeSourcePattern(path);
	if (!normalizedPath) return false;

	return (exclude ?? []).some((pattern) => {
		const normalizedPattern = normalizeSourcePattern(pattern);
		if (!normalizedPattern) return false;
		if (normalizedPattern.endsWith('/**')) {
			const prefix = normalizedPattern.slice(0, -'/**'.length);
			return (
				normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
			);
		}
		return normalizedPath === normalizedPattern;
	});
}

function isIncludedSourcePath(
	path: string,
	include: string[] | undefined,
): boolean {
	if (!include?.length) return true;
	const normalizedPath = normalizeSourcePattern(path);
	if (!normalizedPath) return false;

	return include.some((pattern) => {
		const normalizedPattern = normalizeSourcePattern(pattern);
		if (!normalizedPattern) return false;
		if (normalizedPattern.endsWith('/**')) {
			const prefix = normalizedPattern.slice(0, -'/**'.length);
			return normalizedPath.startsWith(`${prefix}/`);
		}
		return normalizedPath === normalizedPattern;
	});
}

function shouldVisitSourceDirectory(
	path: string,
	include: string[] | undefined,
): boolean {
	if (!include?.length) return true;
	const normalizedPath = normalizeSourcePattern(path);
	if (!normalizedPath) return true;

	return include.some((pattern) => {
		const normalizedPattern = normalizeSourcePattern(pattern);
		if (!normalizedPattern) return false;
		const prefix = normalizedPattern.endsWith('/**')
			? normalizedPattern.slice(0, -'/**'.length)
			: normalizedPattern;
		return (
			prefix === normalizedPath ||
			prefix.startsWith(`${normalizedPath}/`) ||
			normalizedPath.startsWith(`${prefix}/`)
		);
	});
}

export function normalizeSourcePattern(value: string): string {
	return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
