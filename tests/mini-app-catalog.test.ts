import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	buildInstalledMiniApp,
	listInstalledMiniApps,
} from '../packages/server/src/runtime/mini-apps/service';

let root: string;
let projectRoot: string;
let globalAppsRoot: string;
let globalCacheRoot: string;

async function createApp(input: {
	root: string;
	id: string;
	name: string;
	global: boolean;
	project: boolean;
}) {
	const appRoot = join(input.root, input.id);
	await mkdir(join(appRoot, 'src'), { recursive: true });
	await writeFile(
		join(appRoot, 'app.json'),
		JSON.stringify({
			schemaVersion: 1,
			id: input.id,
			name: input.name,
			runtime: 'otto-react',
			entry: 'src/main.tsx',
			availability: {
				global: input.global,
				project: input.project,
				requiresProject: input.project,
			},
		}),
	);
	await writeFile(
		join(appRoot, 'src', 'main.tsx'),
		`export default function App() { return <main>${input.name}</main>; }\n`,
	);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'otto-mini-app-catalog-'));
	projectRoot = join(root, 'project');
	globalAppsRoot = join(root, 'global', 'apps');
	globalCacheRoot = join(root, 'global', 'cache', 'mini-apps');
	await mkdir(join(projectRoot, '.otto', 'apps'), { recursive: true });
	await mkdir(globalAppsRoot, { recursive: true });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('Mini App catalog', () => {
	test('discovers project and global apps by declared availability', async () => {
		await createApp({
			root: join(projectRoot, '.otto', 'apps'),
			id: 'project-health',
			name: 'Project Health',
			global: false,
			project: true,
		});
		await createApp({
			root: globalAppsRoot,
			id: 'github-workbench',
			name: 'GitHub Workbench',
			global: true,
			project: true,
		});
		await createApp({
			root: globalAppsRoot,
			id: 'hidden-global',
			name: 'Hidden Global',
			global: false,
			project: true,
		});

		const apps = await listInstalledMiniApps(projectRoot, { globalAppsRoot });
		expect(apps.map((app) => `${app.scope}:${app.id}`)).toEqual([
			'project:project-health',
			'global:github-workbench',
		]);
	});

	test('builds a global app into the global cache and returns a global route', async () => {
		await createApp({
			root: globalAppsRoot,
			id: 'github-workbench',
			name: 'GitHub Workbench',
			global: true,
			project: true,
		});

		const build = await buildInstalledMiniApp(
			{
				projectId: 'project-1',
				projectRoot,
				scope: 'global',
				appId: 'github-workbench',
			},
			{ globalAppsRoot, globalCacheRoot },
		);

		expect(build.previewPath).toMatch(
			/^\/v1\/mini-apps\/global\/github-workbench\/revisions\/[a-f0-9]{12}\/$/,
		);
		expect(
			await Bun.file(
				join(
					globalCacheRoot,
					'github-workbench',
					build.revisionId,
					'index.html',
				),
			).exists(),
		).toBe(true);
	});
});
