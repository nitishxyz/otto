import { afterEach, describe, expect, it } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { getOttoHomeDir } from '@ottocode/sdk';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APIError } from '../packages/server/src/runtime/errors/api-error.ts';
import {
	listProjectDirectories,
	validateProjectDirectory,
} from '../packages/server/src/runtime/projects/filesystem.ts';
import {
	ProjectManager,
	shutdownProjectManager,
} from '../packages/server/src/runtime/projects/manager.ts';
import { registerProjectsRoutes } from '../packages/server/src/routes/projects.ts';

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'otto-picker-')));
	tempRoots.push(root);
	return root;
}

afterEach(async () => {
	for (const root of tempRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe('project filesystem browsing', () => {
	it('lists sorted host directories, including hidden directories', async () => {
		const root = await createTempRoot();
		await mkdir(join(root, 'zeta'));
		await mkdir(join(root, '.hidden'));
		await mkdir(join(root, 'alpha'));
		await writeFile(join(root, 'not-a-directory.txt'), 'ignored');

		const listing = await listProjectDirectories(root);

		expect(listing.path).toBe(root);
		expect(listing.parent).toBeTruthy();
		expect(listing.directories).toEqual([
			{ name: '.hidden', path: join(root, '.hidden') },
			{ name: 'alpha', path: join(root, 'alpha') },
			{ name: 'zeta', path: join(root, 'zeta') },
		]);
		expect(listing.truncated).toBe(false);
	});

	it('requires an absolute, existing directory', async () => {
		await expect(
			validateProjectDirectory('relative/project'),
		).rejects.toMatchObject({
			code: 'project_path_not_absolute',
			status: 400,
		});

		const root = await createTempRoot();
		const file = join(root, 'file.txt');
		await writeFile(file, 'not a project');
		await expect(validateProjectDirectory(file)).rejects.toMatchObject({
			code: 'project_path_not_directory',
			status: 400,
		});
		await expect(
			validateProjectDirectory(join(root, 'missing')),
		).rejects.toMatchObject({
			code: 'project_path_not_found',
			status: 404,
		});
	});

	it('prevents project runtimes from opening invalid paths', async () => {
		const root = await createTempRoot();
		const file = join(root, 'file.txt');
		await writeFile(file, 'not a project');
		const manager = new ProjectManager();

		await expect(manager.openProject({ path: file })).rejects.toBeInstanceOf(
			APIError,
		);
		await expect(
			manager.openProject({ path: join(root, 'missing') }),
		).rejects.toMatchObject({ code: 'project_path_not_found' });
	});

	it('creates and opens General entirely on the host server', async () => {
		const root = await createTempRoot();
		const previous = {
			HOME: process.env.HOME,
			OTTO_HOME: process.env.OTTO_HOME,
			XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
			XDG_STATE_HOME: process.env.XDG_STATE_HOME,
		};
		process.env.HOME = root;
		process.env.OTTO_HOME = join(root, 'otto-home');
		process.env.XDG_CONFIG_HOME = join(root, 'xdg-config');
		process.env.XDG_STATE_HOME = join(root, 'xdg-state');

		try {
			const app = new OpenAPIHono();
			registerProjectsRoutes(app);
			const response = await app.request('/v1/projects/general/open', {
				method: 'POST',
			});

			expect(response.status).toBe(200);
			const project = (await response.json()) as {
				name: string;
				path: string;
				open: boolean;
			};
			expect(project).toMatchObject({
				name: 'general',
				path: join(getOttoHomeDir(), 'general'),
				open: true,
			});
		} finally {
			await shutdownProjectManager();
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});
});
