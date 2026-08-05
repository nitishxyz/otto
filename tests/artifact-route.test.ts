import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileReactArtifact } from '@ottocode/sdk';
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

async function buildTestArtifact() {
	const projectRoot = await mkdtemp(join(tmpdir(), 'otto-artifact-route-'));
	roots.push(projectRoot);
	const build = await compileReactArtifact(projectRoot, {
		artifactId: 'route-artifact',
		title: 'Route Artifact',
		source:
			'import { Artifact, Header } from \'@otto/artifact\'; export default function App() { return <Artifact><Header title="Artifact route works" /></Artifact>; }',
	});
	const runtime = await getProjectManager().openProject({ path: projectRoot });
	return { build, runtime };
}

describe('Artifact revision routes', () => {
	test('serves immutable documents and scripts by project ID', async () => {
		const { build, runtime } = await buildTestArtifact();
		const app = createApp();
		const base = `http://localhost/v1/artifacts/projects/${runtime.id}/route-artifact/revisions/${build.revisionId}`;
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

	test('does not serve paths outside the immutable revision', async () => {
		const { build, runtime } = await buildTestArtifact();
		const app = createApp();
		const response = await app.request(
			`http://localhost/v1/artifacts/projects/${runtime.id}/route-artifact/revisions/${build.revisionId}/missing.js`,
		);
		expect(response.status).toBe(404);
	});
});
