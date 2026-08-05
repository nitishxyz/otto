import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileMiniApp } from '@ottocode/sdk';
import { createApp } from '@ottocode/server';
import { getProjectManager } from '../packages/server/src/runtime/projects/manager';

const roots: string[] = [];

afterAll(async () => {
	const manager = getProjectManager();
	for (const project of manager.listOpenProjects()) {
		if (roots.includes(project.path)) await manager.closeProject(project.id);
	}
	for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function buildTestApp() {
	const projectRoot = await mkdtemp(join(tmpdir(), 'otto-mini-app-route-'));
	roots.push(projectRoot);
	const appRoot = join(projectRoot, '.otto', 'apps', 'route-app');
	await mkdir(join(appRoot, 'src'), { recursive: true });
	await writeFile(
		join(appRoot, 'app.json'),
		JSON.stringify({
			schemaVersion: 1,
			id: 'route-app',
			name: 'Route App',
			runtime: 'otto-react',
			entry: 'src/main.tsx',
		}),
	);
	await writeFile(
		join(appRoot, 'src', 'main.tsx'),
		'export default function App() { return <main>Route works</main>; }\n',
	);
	const build = await compileMiniApp(projectRoot, appRoot);
	const runtime = await getProjectManager().openProject({ path: projectRoot });
	return { build, runtime };
}

describe('Mini App build routes', () => {
	test('lists and builds saved project apps without a chat message', async () => {
		const { runtime } = await buildTestApp();
		const app = createApp();
		const headers = { 'X-Otto-Project-Id': runtime.id };
		const list = await app.request('http://localhost/v1/mini-apps', {
			headers,
		});
		expect(list.status).toBe(200);
		const catalog = (await list.json()) as {
			apps: Array<{ id: string; scope: string }>;
			projectCount: number;
		};
		expect(catalog.apps).toContainEqual(
			expect.objectContaining({ id: 'route-app', scope: 'project' }),
		);
		expect(catalog.projectCount).toBe(1);

		const build = await app.request(
			'http://localhost/v1/mini-apps/project/route-app/build',
			{ method: 'POST', headers },
		);
		expect(build.status).toBe(200);
		const result = (await build.json()) as {
			previewPath: string;
			app: { id: string };
		};
		expect(result.app.id).toBe('route-app');
		expect(result.previewPath).toContain(
			`/v1/mini-apps/projects/${runtime.id}/route-app/revisions/`,
		);
	});

	test('serves immutable app documents and scripts by project ID', async () => {
		const { build, runtime } = await buildTestApp();
		const app = createApp();
		const base = `http://localhost/v1/mini-apps/projects/${runtime.id}/route-app/revisions/${build.revisionId}`;
		const redirect = await app.request(base);
		expect(redirect.status).toBe(308);

		const document = await app.request(`${base}/`);
		expect(document.status).toBe(200);
		expect(document.headers.get('content-type')).toContain('text/html');
		expect(document.headers.get('content-security-policy')).toContain(
			"connect-src 'none'",
		);
		expect(await document.text()).toContain('./app.js');

		const script = await app.request(`${base}/app.js`);
		expect(script.status).toBe(200);
		expect(script.headers.get('content-type')).toContain('text/javascript');
		expect((await script.arrayBuffer()).byteLength).toBeGreaterThan(100);
	});

	test('does not serve paths outside the immutable build', async () => {
		const { build, runtime } = await buildTestApp();
		const app = createApp();
		const response = await app.request(
			`http://localhost/v1/mini-apps/projects/${runtime.id}/route-app/revisions/${build.revisionId}/missing.js`,
		);
		expect(response.status).toBe(404);
	});
});
