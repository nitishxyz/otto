import { lstat, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
	compileMiniApp,
	compileMiniAppInScope,
	getGlobalAppsCacheDir,
	getGlobalAppsDir,
	inspectMiniApp,
	type MiniAppManifest,
} from '@ottocode/sdk';

export type MiniAppScope = 'project' | 'global';

export type MiniAppServiceOptions = {
	globalAppsRoot?: string;
	globalCacheRoot?: string;
};

export type InstalledMiniApp = {
	id: string;
	name: string;
	description?: string;
	runtime: 'otto-react';
	scope: MiniAppScope;
	entry: string;
	revisionId: string;
	permissions: string[];
	capabilities: string[];
	placements: MiniAppManifest['placements'];
};

function sourceDirectory(
	projectRoot: string,
	scope: MiniAppScope,
	options: MiniAppServiceOptions,
): string {
	return scope === 'project'
		? join(projectRoot, '.otto', 'apps')
		: (options.globalAppsRoot ?? getGlobalAppsDir());
}

async function discoverScope(
	projectRoot: string,
	scope: MiniAppScope,
	options: MiniAppServiceOptions,
): Promise<InstalledMiniApp[]> {
	const root = sourceDirectory(projectRoot, scope, options);
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const apps: InstalledMiniApp[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		try {
			const { manifest, contentHash } = await inspectMiniApp(
				join(root, entry.name),
			);
			if (scope === 'project' && !manifest.availability.project) continue;
			if (scope === 'global' && !manifest.availability.global) continue;
			apps.push({
				id: manifest.id,
				name: manifest.name,
				description: manifest.description,
				runtime: manifest.runtime,
				scope,
				entry: manifest.entry,
				revisionId: contentHash.slice(0, 12),
				permissions: manifest.permissions,
				capabilities: manifest.capabilities,
				placements: manifest.placements,
			});
		} catch {}
	}
	return apps.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listInstalledMiniApps(
	projectRoot: string,
	options: MiniAppServiceOptions = {},
): Promise<InstalledMiniApp[]> {
	const [projectApps, globalApps] = await Promise.all([
		discoverScope(projectRoot, 'project', options),
		discoverScope(projectRoot, 'global', options),
	]);
	return [...projectApps, ...globalApps];
}

async function resolveInstalledApp(
	projectRoot: string,
	scope: MiniAppScope,
	appId: string,
	options: MiniAppServiceOptions,
): Promise<string> {
	if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(appId)) {
		throw new Error(`Invalid Mini App ID: ${appId}`);
	}
	const sourceRoot = sourceDirectory(projectRoot, scope, options);
	const sourceRealRoot = await realpath(sourceRoot);
	const appRoot = await realpath(join(sourceRealRoot, appId));
	const stat = await lstat(appRoot);
	if (!stat.isDirectory()) throw new Error(`Mini App not found: ${appId}`);
	const { manifest } = await inspectMiniApp(appRoot);
	if (manifest.id !== appId) {
		throw new Error(`Mini App directory does not match manifest ID: ${appId}`);
	}
	if (scope === 'project' && !manifest.availability.project) {
		throw new Error(`Mini App is not available to projects: ${appId}`);
	}
	if (scope === 'global' && !manifest.availability.global) {
		throw new Error(`Mini App is not globally available: ${appId}`);
	}
	return appRoot;
}

export async function buildInstalledMiniApp(
	input: {
		projectId: string;
		projectRoot: string;
		scope: MiniAppScope;
		appId: string;
	},
	options: MiniAppServiceOptions = {},
) {
	const appRoot = await resolveInstalledApp(
		input.projectRoot,
		input.scope,
		input.appId,
		options,
	);
	if (input.scope === 'project') {
		const build = await compileMiniApp(input.projectRoot, appRoot);
		return {
			...build,
			previewPath: `/v1/mini-apps/projects/${input.projectId}/${build.manifest.id}/revisions/${build.revisionId}/`,
		};
	}
	return compileMiniAppInScope({
		sourceBoundary: options.globalAppsRoot ?? getGlobalAppsDir(),
		appRoot,
		cacheRoot: options.globalCacheRoot ?? getGlobalAppsCacheDir(),
		previewPath: (appId, revisionId) =>
			`/v1/mini-apps/global/${appId}/revisions/${revisionId}/`,
	});
}
