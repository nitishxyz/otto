import { createHash } from 'node:crypto';
import {
	lstat,
	mkdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
	CURATED_BROWSER_IMPORTS,
	CURATED_BROWSER_RUNTIME_HASH,
	rewriteCuratedBrowserImports,
	writeCuratedBrowserRuntime,
} from './browser-runtime-assets.ts';
import {
	ARTIFACT_BASE_STYLES,
	ARTIFACT_BOXY_STYLES,
	ARTIFACT_RUNTIME_VERSION,
} from './runtime.ts';

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_STYLES_BYTES = 256 * 1024;
const MAX_BUILD_BYTES = 20 * 1024 * 1024;
const ARTIFACT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const REVISION_ID_PATTERN = /^[a-f0-9]{12}$/;

export type ReactArtifactInput = {
	artifactId: string;
	title: string;
	description?: string;
	source: string;
	styles?: string;
};

export type ReactArtifactBuild = {
	artifactId: string;
	title: string;
	description?: string;
	runtime: 'otto-react-artifact';
	contentHash: string;
	revisionId: string;
	buildRoot: string;
	previewPath: string;
	cached: boolean;
	libraries: string[];
};

function pathIsWithin(root: string, target: string): boolean {
	const path = relative(root, target);
	return (
		path === '' ||
		(!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
	);
}

function buildRootFor(
	cacheRoot: string,
	artifactId: string,
	revisionId: string,
): string {
	if (!ARTIFACT_ID_PATTERN.test(artifactId))
		throw new Error('Invalid Artifact ID');
	if (!REVISION_ID_PATTERN.test(revisionId))
		throw new Error('Invalid Artifact revision ID');
	return join(cacheRoot, artifactId, revisionId);
}

function isCuratedImport(specifier: string): boolean {
	return CURATED_BROWSER_IMPORTS.includes(specifier);
}

function formatBuildError(error: unknown): string {
	if (error instanceof AggregateError && error.errors.length > 0) {
		return formatBuildLogs(
			error.errors.map((entry) =>
				entry && typeof entry === 'object'
					? (entry as {
							message?: string;
							position?: {
								file?: string;
								line?: number;
								column?: number;
							} | null;
						})
					: { message: String(entry) },
			),
		);
	}
	return error instanceof Error ? error.message : String(error);
}

function formatBuildLogs(
	logs: Array<{
		message?: string;
		position?: { file?: string; line?: number; column?: number } | null;
	}>,
): string {
	return (
		logs
			.map((log) => {
				const message = log.message?.trim();
				const fallback = String(log).trim();
				const detail =
					message ||
					(fallback && fallback !== '[object Object]' ? fallback : undefined);
				if (!detail) return undefined;
				const position = log.position;
				if (!position) return detail;
				const location = [
					position.file,
					position.line === undefined ? undefined : String(position.line),
					position.column === undefined ? undefined : String(position.column),
				]
					.filter(Boolean)
					.join(':');
				return location ? `${location}: ${detail}` : detail;
			})
			.filter(Boolean)
			.join('\n') || 'Artifact compilation failed'
	);
}

function htmlEscape(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

async function validateArtifactSource(source: string): Promise<void> {
	const transpiler = new Bun.Transpiler({ loader: 'tsx' });
	try {
		transpiler.transformSync(source);
	} catch (error) {
		throw new Error(
			`Artifact source is not valid TSX: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	for (const imported of transpiler.scanImports(source)) {
		if (imported.path === '@otto/artifact' || isCuratedImport(imported.path))
			continue;
		throw new Error(
			`Import "${imported.path}" is not available in the curated Artifact runtime`,
		);
	}
}

async function directorySize(directory: string): Promise<number> {
	let bytes = 0;
	for await (const entry of new Bun.Glob('**/*').scan({
		cwd: directory,
		onlyFiles: true,
	})) {
		bytes += (await lstat(join(directory, entry))).size;
	}
	return bytes;
}

function artifactHash(input: ReactArtifactInput): string {
	return createHash('sha256')
		.update(
			JSON.stringify({
				runtimeVersion: ARTIFACT_RUNTIME_VERSION,
				browserRuntimeHash: CURATED_BROWSER_RUNTIME_HASH,
				artifactId: input.artifactId,
				title: input.title,
				description: input.description ?? null,
				source: input.source,
				styles: input.styles ?? '',
			}),
		)
		.digest('hex');
}

/** Compiles ephemeral TSX into an immutable Otto Artifact revision. */
export async function compileReactArtifact(
	projectRoot: string,
	input: ReactArtifactInput,
): Promise<ReactArtifactBuild> {
	if (!ARTIFACT_ID_PATTERN.test(input.artifactId)) {
		throw new Error('Artifact ID must be lowercase kebab-case');
	}
	if (!input.title.trim()) throw new Error('Artifact title is required');
	if (Buffer.byteLength(input.source) > MAX_SOURCE_BYTES) {
		throw new Error('Artifact source exceeds the 256 KB limit');
	}
	if (Buffer.byteLength(input.styles ?? '') > MAX_STYLES_BYTES) {
		throw new Error('Artifact styles exceed the 256 KB limit');
	}
	await validateArtifactSource(input.source);

	const projectRealRoot = await realpath(projectRoot);
	const cacheRoot = join(projectRealRoot, '.otto', 'cache', 'artifacts');
	await mkdir(cacheRoot, { recursive: true });
	const cacheRealRoot = await realpath(cacheRoot);
	const contentHash = artifactHash(input);
	const revisionId = contentHash.slice(0, 12);
	const buildRoot = buildRootFor(cacheRealRoot, input.artifactId, revisionId);
	const previewPath = `/v1/artifacts/${input.artifactId}/revisions/${revisionId}/`;
	const indexPath = join(buildRoot, 'index.html');
	const baseBuild = {
		artifactId: input.artifactId,
		title: input.title.trim(),
		description: input.description?.trim() || undefined,
		runtime: 'otto-react-artifact' as const,
		contentHash,
		revisionId,
		buildRoot,
		previewPath,
		libraries: ['@otto/artifact', 'react', 'motion', 'lucide-react'],
	};
	if ((await lstat(indexPath).catch(() => null))?.isFile()) {
		return { ...baseBuild, cached: true };
	}

	await rm(buildRoot, { recursive: true, force: true });
	await mkdir(buildRoot, { recursive: true });
	const sourcePath = join(buildRoot, '.artifact.tsx');
	const bootstrapPath = join(buildRoot, '.entry.tsx');
	await Promise.all([
		writeFile(sourcePath, input.source),
		writeFile(
			join(buildRoot, 'base.css'),
			`${ARTIFACT_BASE_STYLES}\n${ARTIFACT_BOXY_STYLES}`,
		),
		writeFile(join(buildRoot, 'artifact.css'), input.styles ?? ''),
		writeFile(
			bootstrapPath,
			`import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport './base.css';\nimport './artifact.css';\nimport App from './.artifact.tsx';\nconst root = document.getElementById('root');\nif (!root) throw new Error('Otto Artifact root was not found');\ncreateRoot(root).render(React.createElement(React.StrictMode, null, React.createElement(App)));\n`,
		),
		writeCuratedBrowserRuntime(buildRoot),
	]);

	try {
		const result = await Bun.build({
			entrypoints: [bootstrapPath],
			outdir: buildRoot,
			target: 'browser',
			format: 'esm',
			minify: true,
			sourcemap: 'none',
			naming: { entry: 'app.[ext]', chunk: 'chunks/[name]-[hash].[ext]' },
			external: CURATED_BROWSER_IMPORTS,
		}).catch((error) => {
			throw new Error(formatBuildError(error));
		});
		if (!result.success) throw new Error(formatBuildLogs(result.logs));
		const appPath = join(buildRoot, 'app.js');
		await writeFile(
			appPath,
			rewriteCuratedBrowserImports(await readFile(appPath, 'utf8')),
		);
		await writeFile(
			indexPath,
			`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><link rel="stylesheet" href="./app.css"><title>${htmlEscape(input.title.trim())}</title></head><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>`,
		);
		await Promise.all([
			rm(sourcePath, { force: true }),
			rm(bootstrapPath, { force: true }),
			rm(join(buildRoot, 'base.css'), { force: true }),
			rm(join(buildRoot, 'artifact.css'), { force: true }),
		]);
		if ((await directorySize(buildRoot)) > MAX_BUILD_BYTES) {
			throw new Error('Artifact build exceeds the 20 MB limit');
		}
	} catch (error) {
		await rm(buildRoot, { recursive: true, force: true });
		throw error;
	}

	return { ...baseBuild, cached: false };
}

/** Resolves one immutable Artifact build asset while preventing traversal. */
export async function resolveArtifactBuildAsset(
	projectRoot: string,
	artifactId: string,
	revisionId: string,
	requestedPath: string,
): Promise<string> {
	const projectRealRoot = await realpath(projectRoot);
	const buildRoot = buildRootFor(
		join(projectRealRoot, '.otto', 'cache', 'artifacts'),
		artifactId,
		revisionId,
	);
	const buildRealRoot = await realpath(buildRoot);
	const relativePath =
		requestedPath && requestedPath !== '/' ? requestedPath : 'index.html';
	const target = resolve(buildRealRoot, relativePath);
	if (!pathIsWithin(buildRealRoot, target))
		throw new Error('Artifact asset path escapes the build root');
	const targetRealPath = await realpath(target);
	if (!pathIsWithin(buildRealRoot, targetRealPath)) {
		throw new Error('Artifact asset resolves outside the build root');
	}
	if (!(await lstat(targetRealPath)).isFile())
		throw new Error('Artifact asset not found');
	return targetRealPath;
}

/** Reads a generated Artifact document for tests and diagnostics. */
export async function readArtifactBuildDocument(
	build: ReactArtifactBuild,
): Promise<string> {
	return readFile(join(build.buildRoot, 'index.html'), 'utf8');
}
