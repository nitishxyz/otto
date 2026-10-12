import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { getGlobalConfigDir } from '@ottocode/sdk';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectManager } from '../packages/server/src/runtime/projects/manager';
import {
	listProjects,
	touchProject,
} from '../packages/server/src/runtime/projects/registry';

let configRoot: string;
const previousConfig = process.env.XDG_CONFIG_HOME;
const previousData = process.env.XDG_DATA_HOME;
beforeAll(async () => {
	configRoot = await mkdtemp(join(tmpdir(), 'otto-project-tests-'));
	process.env.XDG_CONFIG_HOME = configRoot;
	process.env.XDG_DATA_HOME = configRoot;
});
afterAll(async () => {
	if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = previousConfig;
	if (previousData === undefined) delete process.env.XDG_DATA_HOME;
	else process.env.XDG_DATA_HOME = previousData;
	await rm(configRoot, { recursive: true, force: true });
});

test('concurrent canonical first opens share runtime and terminal manager', async () => {
	const root = await mkdtemp(join(tmpdir(), 'otto-open-'));
	const manager = new ProjectManager();
	try {
		await symlink(root, `${root}-alias`);
		const runtimes = await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				manager.openProject({ path: index % 2 ? `${root}-alias` : root }),
			),
		);
		for (const runtime of runtimes) {
			expect(runtime).toBe(runtimes[0]);
			expect(runtime.terminalManager).toBe(runtimes[0].terminalManager);
		}
	} finally {
		await manager.closeAllProjects();
		await rm(root, { recursive: true, force: true });
		await rm(`${root}-alias`, { force: true });
	}
});

test('concurrent registry touches retain every project', async () => {
	const roots = Array.from(
		{ length: 8 },
		(_, i) => `/tmp/otto-registry-${crypto.randomUUID()}-${i}`,
	);
	await Promise.all(roots.map((root) => touchProject(root, 'unused')));
	const projects = await listProjects();
	for (const root of roots)
		expect(projects.some((project) => project.path === root)).toBe(true);
});

test('registry failures propagate and do not debounce a retry', async () => {
	const registry = join(getGlobalConfigDir(), 'projects.json');
	await rm(registry, { force: true });
	await mkdir(registry);
	const root = `/tmp/otto-registry-retry-${crypto.randomUUID()}`;
	await expect(touchProject(root, 'unused')).rejects.toThrow();
	await rm(registry, { recursive: true });
	await touchProject(root, 'unused');
	expect((await listProjects()).some((project) => project.path === root)).toBe(
		true,
	);
});

test('open waits for closing resources and concurrent closes dispose once', async () => {
	const root = await mkdtemp(join(tmpdir(), 'otto-close-'));
	const manager = new ProjectManager();
	try {
		const runtime = await manager.openProject({ path: root });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let stopped = 0;
		const original = runtime.stopIdleResources;
		runtime.stopIdleResources = async () => {
			stopped++;
			await gate;
			await original();
		};
		const closing = manager.closeProject(runtime.id);
		const duplicate = manager.closeProject(runtime.id);
		await Bun.sleep(5);
		const opening = manager.openProject({ path: root });
		release();
		await Promise.all([closing, duplicate]);
		expect(await opening).not.toBe(runtime);
		expect(stopped).toBe(1);
	} finally {
		await manager.closeAllProjects();
		await rm(root, { recursive: true, force: true });
	}
});
