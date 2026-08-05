import { createHash } from 'node:crypto';
import {
	lstat,
	mkdir,
	readFile,
	readdir,
	realpath,
	rm,
	writeFile,
} from 'node:fs/promises';
import {
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from 'node:path';
import {
	CURATED_BROWSER_IMPORTS,
	CURATED_BROWSER_RUNTIME_HASH,
	rewriteCuratedBrowserImports,
	writeCuratedBrowserRuntime,
} from '../artifacts/browser-runtime-assets.ts';
import { inspectMiniApp, type MiniAppManifest } from './manifest.ts';

const MAX_BUILD_BYTES = 20 * 1024 * 1024;
const APP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const REVISION_ID_PATTERN = /^[a-f0-9]{12}$/;

export type MiniAppBuild = {
	manifest: MiniAppManifest;
	contentHash: string;
	revisionId: string;
	buildRoot: string;
	previewPath: string;
	cached: boolean;
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
	appId: string,
	revisionId: string,
): string {
	if (!APP_ID_PATTERN.test(appId)) throw new Error('Invalid Mini App ID');
	if (!REVISION_ID_PATTERN.test(revisionId)) {
		throw new Error('Invalid Mini App revision ID');
	}
	return join(cacheRoot, appId, revisionId);
}

function isCuratedImport(specifier: string): boolean {
	return CURATED_BROWSER_IMPORTS.includes(specifier);
}

function relativeImport(fromDirectory: string, target: string): string {
	const path = relative(fromDirectory, target).replace(/\\/g, '/');
	return path.startsWith('.') ? path : `./${path}`;
}

function formatBuildLogs(logs: Array<{ message?: string }>): string {
	const messages = logs
		.map((log) => String(log).trim() || log.message?.trim())
		.filter((message): message is string => Boolean(message));
	return messages.join('\n') || 'Mini App compilation failed';
}

function sourceLoader(path: string): 'js' | 'jsx' | 'ts' | 'tsx' | null {
	switch (extname(path).toLowerCase()) {
		case '.js':
		case '.mjs':
			return 'js';
		case '.jsx':
			return 'jsx';
		case '.ts':
		case '.mts':
			return 'ts';
		case '.tsx':
			return 'tsx';
		default:
			return null;
	}
}

async function validateCuratedImports(directory: string): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && entry.name === 'node_modules') continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			await validateCuratedImports(path);
			continue;
		}
		if (!entry.isFile()) continue;
		const loader = sourceLoader(path);
		if (!loader) continue;
		const transpiler = new Bun.Transpiler({ loader });
		for (const imported of transpiler.scanImports(
			await readFile(path, 'utf8'),
		)) {
			const specifier = imported.path;
			if (
				specifier.startsWith('.') ||
				specifier.startsWith('/') ||
				isCuratedImport(specifier)
			) {
				continue;
			}
			throw new Error(
				`Package import "${specifier}" is not available in the curated Mini App runtime`,
			);
		}
	}
}

async function buildSize(directory: string): Promise<number> {
	let bytes = 0;
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) bytes += await buildSize(path);
		else if (entry.isFile()) bytes += (await lstat(path)).size;
	}
	return bytes;
}

async function writeAppDocument(buildRoot: string, hasCss: boolean) {
	const styles = hasCss ? '<link rel="stylesheet" href="./app.css">' : '';
	await writeFile(
		join(buildRoot, 'index.html'),
		`<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="./base.css">
${styles}
<title>Otto Mini App</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="./app.js"></script>
</body>
</html>
`,
	);
	await writeFile(
		join(buildRoot, 'base.css'),
		`*{box-sizing:border-box}html,body,#root{min-height:100%;margin:0}body{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#111827}@media(prefers-color-scheme:dark){body{background:#09090b;color:#f4f4f5}}button,input,select,textarea{font:inherit}\n`,
	);
}

export type MiniAppCompileScope = {
	sourceBoundary: string;
	appRoot: string;
	cacheRoot: string;
	previewPath: (appId: string, revisionId: string) => string;
};

/** Compiles one `otto-react` Mini App within an explicit storage scope. */
export async function compileMiniAppInScope(
	scope: MiniAppCompileScope,
): Promise<MiniAppBuild> {
	const [sourceBoundary, appRealRoot] = await Promise.all([
		realpath(scope.sourceBoundary),
		realpath(scope.appRoot),
	]);
	if (!pathIsWithin(sourceBoundary, appRealRoot)) {
		throw new Error('Mini App root must stay within its source scope');
	}
	const { manifest, contentHash: sourceHash } =
		await inspectMiniApp(appRealRoot);
	await validateCuratedImports(appRealRoot);
	const contentHash = createHash('sha256')
		.update(sourceHash)
		.update(CURATED_BROWSER_RUNTIME_HASH)
		.digest('hex');
	const revisionId = contentHash.slice(0, 12);
	await mkdir(scope.cacheRoot, { recursive: true });
	const cacheRoot = await realpath(scope.cacheRoot);
	const buildRoot = buildRootFor(cacheRoot, manifest.id, revisionId);
	const previewPath = scope.previewPath(manifest.id, revisionId);
	const indexPath = join(buildRoot, 'index.html');
	if ((await lstat(indexPath).catch(() => null))?.isFile()) {
		return {
			manifest,
			contentHash,
			revisionId,
			buildRoot,
			previewPath,
			cached: true,
		};
	}

	await rm(buildRoot, { recursive: true, force: true });
	await mkdir(buildRoot, { recursive: true });
	const bootstrapPath = join(buildRoot, '.entry.tsx');
	const entryPath = resolve(appRealRoot, manifest.entry);
	const appImport = relativeImport(dirname(bootstrapPath), entryPath);
	await writeFile(
		bootstrapPath,
		`import React from 'react';
import { createRoot } from 'react-dom/client';
import App from ${JSON.stringify(appImport)};

const root = document.getElementById('root');
if (!root) throw new Error('Otto Mini App root element was not found');
createRoot(root).render(React.createElement(React.StrictMode, null, React.createElement(App)));
`,
	);
	await writeCuratedBrowserRuntime(buildRoot);

	try {
		const result = await Bun.build({
			entrypoints: [bootstrapPath],
			outdir: buildRoot,
			target: 'browser',
			format: 'esm',
			minify: true,
			sourcemap: 'none',
			naming: {
				entry: 'app.[ext]',
				chunk: 'chunks/[name]-[hash].[ext]',
				asset: 'assets/[name]-[hash].[ext]',
			},
			external: CURATED_BROWSER_IMPORTS,
		});
		if (!result.success) throw new Error(formatBuildLogs(result.logs));
		const appPath = join(buildRoot, 'app.js');
		await writeFile(
			appPath,
			rewriteCuratedBrowserImports(await readFile(appPath, 'utf8')),
		);
		const hasCss = result.outputs.some(
			(output) => extname(output.path).toLowerCase() === '.css',
		);
		await writeAppDocument(buildRoot, hasCss);
		await rm(bootstrapPath, { force: true });
		if ((await buildSize(buildRoot)) > MAX_BUILD_BYTES) {
			throw new Error('Mini App build exceeds the 20 MB limit');
		}
	} catch (error) {
		await rm(buildRoot, { recursive: true, force: true });
		throw error;
	}

	return {
		manifest,
		contentHash,
		revisionId,
		buildRoot,
		previewPath,
		cached: false,
	};
}

/** Compiles one project-scoped Mini App into immutable browser assets. */
export async function compileMiniApp(
	projectRoot: string,
	appRoot: string,
): Promise<MiniAppBuild> {
	const projectRealRoot = await realpath(projectRoot);
	return compileMiniAppInScope({
		sourceBoundary: projectRealRoot,
		appRoot,
		cacheRoot: join(projectRealRoot, '.otto', 'cache', 'mini-apps'),
		previewPath: (appId, revisionId) =>
			`/v1/mini-apps/${appId}/revisions/${revisionId}/`,
	});
}

/** Resolves one immutable build asset while preventing traversal. */
export async function resolveMiniAppBuildAsset(
	projectRoot: string,
	appId: string,
	revisionId: string,
	requestedPath: string,
): Promise<string> {
	const projectRealRoot = await realpath(projectRoot);
	return resolveMiniAppBuildAssetInCache(
		join(projectRealRoot, '.otto', 'cache', 'mini-apps'),
		appId,
		revisionId,
		requestedPath,
	);
}

/** Resolves one immutable build asset from an explicit cache root. */
export async function resolveMiniAppBuildAssetInCache(
	cacheRoot: string,
	appId: string,
	revisionId: string,
	requestedPath: string,
): Promise<string> {
	const buildRoot = buildRootFor(cacheRoot, appId, revisionId);
	const buildRealRoot = await realpath(buildRoot);
	const relativePath =
		requestedPath && requestedPath !== '/' ? requestedPath : 'index.html';
	const target = resolve(buildRealRoot, relativePath);
	if (!pathIsWithin(buildRealRoot, target)) {
		throw new Error('Mini App asset path escapes the build root');
	}
	const targetRealPath = await realpath(target);
	if (!pathIsWithin(buildRealRoot, targetRealPath)) {
		throw new Error('Mini App asset resolves outside the build root');
	}
	const stat = await lstat(targetRealPath);
	if (!stat.isFile()) throw new Error('Mini App asset not found');
	return targetRealPath;
}

/** Reads a generated document for tests and diagnostics. */
export async function readMiniAppBuildDocument(
	build: MiniAppBuild,
): Promise<string> {
	return readFile(join(build.buildRoot, 'index.html'), 'utf8');
}
