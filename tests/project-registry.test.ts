import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import {
	getProjectDbPath,
	getProjectId,
	getProjectStateDir,
} from '@ottocode/sdk';
import {
	listProjects,
	touchProject,
} from '../packages/server/src/runtime/projects/registry.ts';

async function withProject(
	prefix: string,
	fn: (projectRoot: string, ottoHome: string) => Promise<void>,
) {
	const projectRoot = await mkdtemp(join(tmpdir(), prefix));
	const previousOttoHome = process.env.OTTO_HOME;
	const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
	const ottoHome = join(projectRoot, 'otto-home');
	process.env.OTTO_HOME = ottoHome;
	process.env.XDG_CONFIG_HOME = join(projectRoot, 'xdg-config');
	try {
		await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true });
		await fn(projectRoot, ottoHome);
	} finally {
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
		await rm(projectRoot, { recursive: true, force: true });
	}
}

describe('project registry', () => {
	it('stores project id, state dir, and state database path', async () => {
		await withProject('otto-registry-', async (projectRoot) => {
			const expectedId = await getProjectId(projectRoot);
			const expectedStateDir = await getProjectStateDir(projectRoot);
			const expectedDbPath = await getProjectDbPath(projectRoot);

			await touchProject(
				projectRoot,
				join(projectRoot, '.otto', 'otto.sqlite'),
			);
			const projects = await listProjects();
			const project = projects.find((item) => item.path === projectRoot);

			expect(project).toBeDefined();
			expect(project?.id).toBe(expectedId);
			expect(project?.stateDir).toBe(expectedStateDir);
			expect(project?.dbPath).toBe(expectedDbPath);
			expect(project?.dbPath).not.toBe(
				join(projectRoot, '.otto', 'otto.sqlite'),
			);
		});
	});

	it('normalizes stale stored state and database paths when loading', async () => {
		await withProject('otto-registry-stale-', async (projectRoot) => {
			const expectedId = await getProjectId(projectRoot);
			const expectedStateDir = await getProjectStateDir(projectRoot);
			const expectedDbPath = await getProjectDbPath(projectRoot);
			const staleStateDir = join(projectRoot, '.otto');
			const staleDbPath = join(staleStateDir, 'otto.sqlite');
			const registryDir = join(process.env.XDG_CONFIG_HOME ?? '', 'otto');

			await mkdir(registryDir, { recursive: true });
			await writeFile(
				join(registryDir, 'projects.json'),
				`${JSON.stringify(
					{
						version: 1,
						projects: [
							{
								id: 'stale-id',
								name: 'stale-name',
								path: projectRoot,
								stateDir: staleStateDir,
								dbPath: staleDbPath,
								firstSeenAt: 100,
								lastSeenAt: 200,
							},
						],
					},
					null,
					2,
				)}\n`,
			);

			const projects = await listProjects();
			const project = projects.find((item) => item.path === projectRoot);

			expect(project).toBeDefined();
			expect(project?.id).toBe(expectedId);
			expect(project?.stateDir).toBe(expectedStateDir);
			expect(project?.stateDir).not.toBe(staleStateDir);
			expect(project?.dbPath).toBe(expectedDbPath);
			expect(project?.dbPath).not.toBe(staleDbPath);
			expect(project?.firstSeenAt).toBe(100);
			expect(project?.lastSeenAt).toBe(200);
		});
	});

	it('discovers migrated project state directories missing from the registry', async () => {
		await withProject('otto-registry-discover-', async (projectRoot) => {
			const expectedId = await getProjectId(projectRoot);
			const expectedStateDir = await getProjectStateDir(projectRoot);
			const expectedDbPath = await getProjectDbPath(projectRoot);
			const createdAt = '2026-01-02T03:04:05.000Z';
			const lastSeenAt = '2026-01-03T04:05:06.000Z';

			await mkdir(expectedStateDir, { recursive: true });
			await writeFile(expectedDbPath, '');
			await writeFile(
				join(expectedStateDir, 'project.json'),
				`${JSON.stringify(
					{
						id: expectedId,
						name: 'migrated-project',
						root: projectRoot,
						createdAt,
						lastSeenAt,
					},
					null,
					2,
				)}\n`,
			);

			const projects = await listProjects();
			const project = projects.find((item) => item.path === projectRoot);

			expect(project).toBeDefined();
			expect(project?.id).toBe(expectedId);
			expect(project?.name).toBe('migrated-project');
			expect(project?.stateDir).toBe(expectedStateDir);
			expect(project?.dbPath).toBe(expectedDbPath);
			expect(project?.firstSeenAt).toBe(Date.parse(createdAt));
			expect(project?.lastSeenAt).toBe(Date.parse(lastSeenAt));
		});
	});
});
