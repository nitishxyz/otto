import { OpenAPIHono } from '@hono/zod-openapi';
import { afterEach, describe, expect, it } from 'bun:test';
import type { CreateTerminalOptions, TerminalManager } from '@ottocode/sdk';
import { getTerminalManager } from '@ottocode/sdk';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTerminalsRoutes } from '../packages/server/src/routes/terminals.ts';
import {
	getProjectManager,
	ProjectManager,
	type ProjectRuntime,
} from '../packages/server/src/runtime/projects/manager.ts';

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

describe('terminal project scoping', () => {
	it('creates and lists terminals only in the request project runtime', async () => {
		const projectA = await createTempProject('otto-terminal-project-a-');
		const projectB = await createTempProject('otto-terminal-project-b-');
		const restoreEnv = withIsolatedOttoHome(projectA);
		const manager = getProjectManager();
		try {
			await mkdir(process.env.XDG_CONFIG_HOME ?? '', { recursive: true });
			const runtimeA = await manager.getProject({ path: projectA });
			const runtimeB = await manager.getProject({ path: projectB });
			mockTerminalManager(runtimeA, 'a');
			mockTerminalManager(runtimeB, 'b');

			const app = new OpenAPIHono();
			registerTerminalsRoutes(app);

			const createdA = await app.request(
				`/v1/terminals?project=${encodeURIComponent(projectA)}`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						command: 'echo',
						args: ['a'],
						purpose: 'project a terminal',
					}),
				},
			);
			expect(createdA.status).toBe(200);
			expect(await createdA.json()).toMatchObject({ terminalId: 'a-1' });

			const listA = await app.request(
				`/v1/terminals?project=${encodeURIComponent(projectA)}`,
			);
			const listB = await app.request(
				`/v1/terminals?project=${encodeURIComponent(projectB)}`,
			);

			expect(await listA.json()).toMatchObject({
				count: 1,
				terminals: [expect.objectContaining({ id: 'a-1' })],
			});
			expect(await listB.json()).toEqual({ count: 0, terminals: [] });
		} finally {
			await manager.closeProject(
				(await manager.getProject({ path: projectA })).id,
			);
			await manager.closeProject(
				(await manager.getProject({ path: projectB })).id,
			);
			await restoreEnv();
		}
	});

	it('project cleanup kills only that project terminal manager', async () => {
		const projectA = await createTempProject('otto-terminal-cleanup-a-');
		const projectB = await createTempProject('otto-terminal-cleanup-b-');
		const restoreEnv = withIsolatedOttoHome(projectA);
		try {
			await mkdir(process.env.XDG_CONFIG_HOME ?? '', { recursive: true });
			const manager = new ProjectManager();
			const runtimeA = await manager.openProject({ path: projectA });
			const runtimeB = await manager.openProject({ path: projectB });
			let killedA = 0;
			let killedB = 0;
			runtimeA.terminalManager.killAll = async () => {
				killedA += 1;
			};
			runtimeB.terminalManager.killAll = async () => {
				killedB += 1;
			};

			expect(getTerminalManager(projectA)).toBe(runtimeA.terminalManager);
			expect(getTerminalManager(projectB)).toBe(runtimeB.terminalManager);

			await manager.closeProject(runtimeA.id);

			expect(killedA).toBe(1);
			expect(killedB).toBe(0);
			expect(getTerminalManager(projectA)).toBeNull();
			expect(getTerminalManager(projectB)).toBe(runtimeB.terminalManager);

			await manager.closeProject(runtimeB.id);
			expect(killedB).toBe(1);
			expect(getTerminalManager(projectB)).toBeNull();
		} finally {
			await restoreEnv();
		}
	});
});

function mockTerminalManager(runtime: ProjectRuntime, prefix: string): void {
	const terminals: unknown[] = [];
	let nextId = 1;
	const manager = runtime.terminalManager as TerminalManager;
	manager.create = (options: CreateTerminalOptions) => {
		const id = `${prefix}-${nextId++}`;
		const terminal = fakeTerminal(id, options);
		terminals.push(terminal);
		return terminal as ReturnType<TerminalManager['create']>;
	};
	manager.list = () => terminals as ReturnType<TerminalManager['list']>;
	manager.get = (id: string) =>
		terminals.find((terminal) => fakeTerminalId(terminal) === id) as ReturnType<
			TerminalManager['get']
		>;
	manager.killAll = async () => {
		terminals.length = 0;
	};
}

function fakeTerminal(id: string, options: CreateTerminalOptions) {
	return {
		id,
		pid: 1000,
		command: options.command,
		args: options.args ?? [],
		cwd: options.cwd,
		purpose: options.purpose,
		createdBy: options.createdBy,
		title: options.title ?? options.purpose,
		status: 'running',
		createdAt: new Date(),
		get uptime() {
			return 0;
		},
		toJSON() {
			return {
				id,
				pid: 1000,
				command: options.command,
				args: options.args ?? [],
				cwd: options.cwd,
				purpose: options.purpose,
				createdBy: options.createdBy,
				title: options.title ?? options.purpose,
				status: 'running',
				createdAt: new Date().toISOString(),
				uptime: 0,
			};
		},
	};
}

function fakeTerminalId(terminal: unknown): string | undefined {
	return typeof terminal === 'object' && terminal !== null && 'id' in terminal
		? String(terminal.id)
		: undefined;
}
