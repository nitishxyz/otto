import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import {
	getProjectDbPath,
	getProjectId,
	getProjectStateDir,
} from '@ottocode/sdk';
import {
	forgetProject,
	listProjects,
	setProjectPinned,
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

	it('keeps an in-flight write bound to its original registry paths', async () => {
		await withProject('otto-registry-race-', async (projectRoot, ottoHome) => {
			const originalXdgConfigHome = process.env.XDG_CONFIG_HOME ?? '';
			const otherHome = join(projectRoot, 'other-otto-home');
			const otherXdgConfigHome = join(projectRoot, 'other-xdg-config');

			const touch = touchProject(projectRoot, 'ignored');
			process.env.OTTO_HOME = otherHome;
			process.env.XDG_CONFIG_HOME = otherXdgConfigHome;
			await touch;

			const registryPath = join(originalXdgConfigHome, 'otto', 'projects.json');
			const registry = (await Bun.file(registryPath).json()) as {
				projects: Array<{ path: string; stateDir: string }>;
			};
			expect(registry.projects).toHaveLength(1);
			expect(registry.projects[0]?.path).toBe(projectRoot);
			expect(registry.projects[0]?.stateDir.startsWith(ottoHome)).toBe(true);
			expect(
				await Bun.file(
					join(otherXdgConfigHome, 'otto', 'projects.json'),
				).exists(),
			).toBe(false);
		});
	});

	it('forgets only the recent-list record and preserves project files', async () => {
		await withProject(
			'otto-registry-forget-',
			async (projectRoot, ottoHome) => {
				const sentinel = join(projectRoot, 'keep.txt');
				const stateDir = await getProjectStateDir(projectRoot);
				await writeFile(sentinel, 'keep');
				await touchProject(projectRoot, 'ignored');
				await mkdir(stateDir, { recursive: true });
				await writeFile(join(stateDir, 'otto.sqlite'), '');
				await writeFile(
					join(stateDir, 'project.json'),
					JSON.stringify({ root: projectRoot }),
				);

				await forgetProject(projectRoot);

				expect(
					(await listProjects()).some((item) => item.path === projectRoot),
				).toBe(false);
				expect(await Bun.file(sentinel).text()).toBe('keep');
				expect(stateDir.startsWith(ottoHome)).toBe(true);
				expect(await Bun.file(join(stateDir, 'project.json')).exists()).toBe(
					true,
				);
			},
		);
	});

	it('persists pin and unpin state without touching project files', async () => {
		await withProject('otto-registry-pinned-', async (projectRoot) => {
			await touchProject(projectRoot, 'ignored');
			expect(await setProjectPinned(projectRoot, true)).toBe(true);
			expect(
				(await listProjects()).find((item) => item.path === projectRoot)
					?.pinned,
			).toBe(true);

			expect(await setProjectPinned(projectRoot, false)).toBe(true);
			expect(
				(await listProjects()).find((item) => item.path === projectRoot)
					?.pinned,
			).toBe(false);
			expect((await stat(projectRoot)).isDirectory()).toBe(true);
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

	it('skips state directories missing project metadata', async () => {
		await withProject(
			'otto-registry-orphan-',
			async (projectRoot, ottoHome) => {
				const orphanStateDir = join(ottoHome, 'projects', 'orphan-project');
				await mkdir(orphanStateDir, { recursive: true });
				await writeFile(join(orphanStateDir, 'otto.sqlite'), '');

				const projects = await listProjects();

				expect(
					projects.find((item) => item.path === projectRoot),
				).toBeUndefined();
			},
		);
	});
});
