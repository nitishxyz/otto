import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod/v3';

const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_APP_FILES = 500;
const MAX_APP_SOURCE_BYTES = 10 * 1024 * 1024;
const HASH_EXCLUDED_DIRECTORIES = new Set([
	'.git',
	'dist',
	'build',
	'node_modules',
]);
const capabilityIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

function isRelativeAppPath(value: string): boolean {
	if (!value || isAbsolute(value)) return false;
	const normalized = value.replace(/\\/g, '/');
	return !normalized.split('/').some((part) => part === '..' || part === '');
}

const appPathSchema = z
	.string()
	.min(1)
	.max(256)
	.refine(isRelativeAppPath, 'Path must stay within the Mini App directory');

export const miniAppManifestSchema = z
	.object({
		$schema: z.literal('otto://schemas/mini-app/v1').optional(),
		schemaVersion: z.literal(1),
		id: z
			.string()
			.min(2)
			.max(64)
			.regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
				message:
					'Mini App IDs must use lowercase letters, numbers, and hyphens',
			}),
		name: z.string().min(1).max(80),
		description: z.string().max(280).optional(),
		runtime: z.literal('otto-react'),
		entry: appPathSchema,
		icon: appPathSchema.optional(),
		availability: z
			.object({
				global: z.boolean().default(false),
				project: z.boolean().default(true),
				requiresProject: z.boolean().default(true),
			})
			.default({ global: false, project: true, requiresProject: true }),
		permissions: z.array(capabilityIdSchema).max(64).default([]),
		capabilities: z.array(capabilityIdSchema).max(64).default([]),
		placements: z
			.array(z.enum(['apps', 'project', 'commandPalette']))
			.max(8)
			.default(['apps']),
	})
	.strict();

export type MiniAppManifest = z.infer<typeof miniAppManifestSchema>;

export type MiniAppArtifact = {
	kind: 'mini_app';
	schemaVersion: 1;
	appId: string;
	name: string;
	description?: string;
	runtime: 'otto-react';
	root: string;
	entry: string;
	contentHash: string;
	revisionId: string;
	availability: MiniAppManifest['availability'];
	permissions: string[];
	capabilities: string[];
	placements: MiniAppManifest['placements'];
	previewUrl?: string;
	previewPath?: string;
};

function pathIsWithin(root: string, target: string): boolean {
	const path = relative(root, target);
	return (
		path === '' ||
		(!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
	);
}

async function requireFileWithinRoot(
	appRoot: string,
	relativePath: string,
): Promise<string> {
	const target = resolve(appRoot, relativePath);
	if (!pathIsWithin(appRoot, target)) {
		throw new Error(`Mini App path escapes its root: ${relativePath}`);
	}
	const targetRealPath = await realpath(target).catch(() => null);
	if (!targetRealPath)
		throw new Error(`Mini App file not found: ${relativePath}`);
	if (!pathIsWithin(appRoot, targetRealPath)) {
		throw new Error(`Mini App path resolves outside its root: ${relativePath}`);
	}
	const stat = await lstat(targetRealPath);
	if (!stat.isFile())
		throw new Error(`Mini App path is not a file: ${relativePath}`);
	return targetRealPath;
}

async function collectSourceFiles(
	root: string,
	directory = root,
	files: string[] = [],
): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		if (entry.isDirectory() && HASH_EXCLUDED_DIRECTORIES.has(entry.name)) {
			continue;
		}
		const absolutePath = join(directory, entry.name);
		if (entry.isSymbolicLink()) {
			throw new Error(
				`Mini App source cannot contain symbolic links: ${relative(root, absolutePath)}`,
			);
		}
		if (entry.isDirectory()) {
			await collectSourceFiles(root, absolutePath, files);
			continue;
		}
		if (!entry.isFile()) continue;
		files.push(absolutePath);
		if (files.length > MAX_APP_FILES) {
			throw new Error(`Mini App source exceeds ${MAX_APP_FILES} files`);
		}
	}
	return files;
}

async function hashMiniAppSource(appRoot: string): Promise<string> {
	const files = await collectSourceFiles(appRoot);
	const hash = createHash('sha256');
	let totalBytes = 0;
	for (const file of files) {
		const content = await readFile(file);
		totalBytes += content.byteLength;
		if (totalBytes > MAX_APP_SOURCE_BYTES) {
			throw new Error('Mini App source exceeds the 10 MB validation limit');
		}
		hash.update(relative(appRoot, file).replace(/\\/g, '/'));
		hash.update('\0');
		hash.update(content);
		hash.update('\0');
	}
	return hash.digest('hex');
}

export async function inspectMiniApp(
	root: string,
): Promise<{ manifest: MiniAppManifest; contentHash: string }> {
	const appRoot = await realpath(root).catch(() => null);
	if (!appRoot) throw new Error(`Mini App directory not found: ${root}`);
	const rootStat = await lstat(appRoot);
	if (!rootStat.isDirectory())
		throw new Error(`Mini App root is not a directory: ${root}`);

	const manifestPath = await requireFileWithinRoot(appRoot, 'app.json');
	const manifestStat = await lstat(manifestPath);
	if (manifestStat.size > MAX_MANIFEST_BYTES) {
		throw new Error('Mini App manifest exceeds 128 KB');
	}
	let manifestJson: unknown;
	try {
		manifestJson = JSON.parse(await readFile(manifestPath, 'utf8'));
	} catch (error) {
		throw new Error(
			`Invalid Mini App manifest JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const manifest = miniAppManifestSchema.parse(manifestJson);
	await requireFileWithinRoot(appRoot, manifest.entry);
	if (manifest.icon) await requireFileWithinRoot(appRoot, manifest.icon);
	const contentHash = await hashMiniAppSource(appRoot);
	return { manifest, contentHash };
}
