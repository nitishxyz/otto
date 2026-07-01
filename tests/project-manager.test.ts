import { afterEach, describe, expect, it } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { getProjectId } from '@ottocode/sdk';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectManager } from '../packages/server/src/runtime/projects/manager.ts';
import {
	projectQuerySchema,
	resolveRequestProject,
} from '../packages/server/src/routes/project-context.ts';

const tempRoots: string[] = [];

async function createTempProject(prefix: string): Promise<string> {
	const projectRoot = await realpath(await mkdtemp(join(tmpdir(), prefix)));
	tempRoots.push(projectRoot);
	return projectRoot;
}

function withIsolatedOttoHome(projectRoot: string) {
	const previousOttoHome = process.env.OTTO_HOME;
	const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
	process.env.OTTO_HOME = join(projectRoot, 'otto-home');
	process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');

	return async () => {
		if (previousOttoHome === undefined) {
			delete process.env.OTTO_HOME;
		} else {
			process.env.OTTO_HOME = previousOttoHome;
		}
		if (previousXdgConfigHome === undefined) {
			delete process.env.XDG_CONFIG_HOME;
		} else {
			process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
		}
	};
}

afterEach(async () => {
	for (const root of tempRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe('ProjectManager', () => {
	it('opens two temp projects as distinct runtimes', async () => {
		const projectA = await createTempProject('otto-project-a-');
		const projectB = await createTempProject('otto-project-b-');
		const restoreEnv = withIsolatedOttoHome(projectA);
		try {
			await mkdir(process.env.XDG_CONFIG_HOME ?? '', { recursive: true });
			const manager = new ProjectManager();

			const runtimeA = await manager.openProject({ path: projectA });
			const runtimeB = await manager.openProject({ path: projectB });

			expect(runtimeA).not.toBe(runtimeB);
			expect(runtimeA.id).not.toBe(runtimeB.id);
			expect(runtimeA.root).toBe(projectA);
			expect(runtimeB.root).toBe(projectB);
			expect(runtimeA.db).not.toBe(runtimeB.db);
			expect(manager.listOpenProjects()).toHaveLength(2);
		} finally {
			await restoreEnv();
		}
	});

	it('prefers projectId over legacy project path when both are present', async () => {
		const projectA = await createTempProject('otto-project-id-a-');
		const projectB = await createTempProject('otto-project-id-b-');
		const restoreEnv = withIsolatedOttoHome(projectA);
		try {
			await mkdir(process.env.XDG_CONFIG_HOME ?? '', { recursive: true });
			const expectedProjectId = await getProjectId(projectA);
			const app = createProjectContextTestApp();
			await app.request(`/context?project=${encodeURIComponent(projectA)}`);

			const response = await app.request(
				`/context?projectId=${expectedProjectId}&project=${encodeURIComponent(projectB)}`,
			);
			expect(response.status).toBe(200);

			expect(await response.json()).toEqual({
				id: expectedProjectId,
				path: projectA,
			});
		} finally {
			await restoreEnv();
		}
	});

	it('supports project context headers with project id precedence', async () => {
		const projectA = await createTempProject('otto-project-header-a-');
		const projectB = await createTempProject('otto-project-header-b-');
		const restoreEnv = withIsolatedOttoHome(projectA);
		try {
			await mkdir(process.env.XDG_CONFIG_HOME ?? '', { recursive: true });
			const expectedProjectId = await getProjectId(projectA);
			const app = createProjectContextTestApp();
			await app.request(`/context?project=${encodeURIComponent(projectA)}`);

			const byPathHeader = await app.request('/context', {
				headers: { 'X-Otto-Project': projectB },
			});
			expect(byPathHeader.status).toBe(200);
			expect(await byPathHeader.json()).toEqual({
				id: await getProjectId(projectB),
				path: projectB,
			});

			const byIdHeader = await app.request('/context', {
				headers: {
					'X-Otto-Project-Id': expectedProjectId,
					'X-Otto-Project': projectB,
				},
			});
			expect(byIdHeader.status).toBe(200);
			expect(await byIdHeader.json()).toEqual({
				id: expectedProjectId,
				path: projectA,
			});
		} finally {
			await restoreEnv();
		}
	});
});

function createProjectContextTestApp() {
	const app = new OpenAPIHono();
	app.get('/context', async (c) => {
		projectQuerySchema.parse({
			project: c.req.query('project'),
			projectId: c.req.query('projectId'),
		});
		const ctx = await resolveRequestProject(c);
		return c.json({ id: ctx.projectId, path: ctx.projectRoot });
	});
	return app;
}

describe('resolveRequestProject', () => {
	it('resolves ?project= and ?projectId= to the same opened project', async () => {
		const projectRoot = await createTempProject('otto-project-context-');
		const restoreEnv = withIsolatedOttoHome(projectRoot);
		try {
			await mkdir(process.env.XDG_CONFIG_HOME ?? '', { recursive: true });
			const expectedProjectId = await getProjectId(projectRoot);
			const app = new OpenAPIHono();
			app.get('/context', async (c) => {
				projectQuerySchema.parse({
					project: c.req.query('project'),
					projectId: c.req.query('projectId'),
				});
				const ctx = await resolveRequestProject(c);
				return c.json({ id: ctx.projectId, path: ctx.projectRoot });
			});

			const byPath = await app.request(
				`/context?project=${encodeURIComponent(projectRoot)}`,
			);
			expect(byPath.status).toBe(200);
			const byPathBody = (await byPath.json()) as { id: string; path: string };

			const byId = await app.request(`/context?projectId=${expectedProjectId}`);
			expect(byId.status).toBe(200);
			const byIdBody = (await byId.json()) as { id: string; path: string };

			expect(byPathBody).toEqual(byIdBody);
			expect(byPathBody.id).toBe(expectedProjectId);
			expect(byPathBody.path).toBe(projectRoot);
		} finally {
			await restoreEnv();
		}
	});
});
