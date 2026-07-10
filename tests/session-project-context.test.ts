import { OpenAPIHono } from '@hono/zod-openapi';
import { registerSessionsRoutes } from '@ottocode/server';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerProjectsRoutes } from '../packages/server/src/routes/projects.ts';

const tempRoots: string[] = [];

async function createTempProject(prefix: string): Promise<string> {
	const projectRoot = await realpath(await mkdtemp(join(tmpdir(), prefix)));
	tempRoots.push(projectRoot);
	return projectRoot;
}

function withIsolatedEnv(projectRoot: string) {
	const previousOttoHome = process.env.OTTO_HOME;
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
	const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
	const home = join(projectRoot, 'home');
	process.env.OTTO_HOME = join(home, 'otto-home');
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	process.env.XDG_CONFIG_HOME = join(home, '.config');
	process.env.ANTHROPIC_API_KEY = 'test-key';

	return async () => {
		if (previousOttoHome === undefined) delete process.env.OTTO_HOME;
		else process.env.OTTO_HOME = previousOttoHome;
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
		if (previousAnthropicKey === undefined)
			delete process.env.ANTHROPIC_API_KEY;
		else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
	};
}

async function createSession(app: OpenAPIHono, url: string, title: string) {
	const response = await app.request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			title,
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			allowUnknownModel: true,
		}),
	});
	expect(response.status).toBe(201);
	return (await response.json()) as { id: string; title: string };
}

async function listSessions(app: OpenAPIHono, url: string) {
	const response = await app.request(url);
	expect(response.status).toBe(200);
	return (await response.json()) as {
		items: Array<{ id: string; title: string }>;
	};
}

afterEach(async () => {
	for (const root of tempRoots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe('session project context', () => {
	it('isolates sessions by project in one app and preserves ?project= support', async () => {
		const projectA = await createTempProject('otto-session-project-a-');
		const projectB = await createTempProject('otto-session-project-b-');
		const restoreEnv = withIsolatedEnv(projectA);
		try {
			await mkdir(process.env.XDG_CONFIG_HOME ?? '', { recursive: true });
			const app = new OpenAPIHono();
			registerProjectsRoutes(app);
			registerSessionsRoutes(app);

			const openedB = await app.request('/v1/projects/open', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path: projectB }),
			});
			expect(openedB.status).toBe(200);
			const projectBContext = (await openedB.json()) as { id: string };

			const sessionA = await createSession(
				app,
				`/v1/sessions?project=${encodeURIComponent(projectA)}`,
				'project-a-session',
			);
			const sessionB = await createSession(
				app,
				`/v1/sessions?projectId=${encodeURIComponent(projectBContext.id)}`,
				'project-b-session',
			);

			const listedA = await listSessions(
				app,
				`/v1/sessions?project=${encodeURIComponent(projectA)}`,
			);
			const listedBById = await listSessions(
				app,
				`/v1/sessions?projectId=${encodeURIComponent(projectBContext.id)}`,
			);
			const listedBByPath = await listSessions(
				app,
				`/v1/sessions?project=${encodeURIComponent(projectB)}`,
			);

			expect(listedA.items.map((item) => item.id)).toEqual([sessionA.id]);
			expect(listedBById.items.map((item) => item.id)).toEqual([sessionB.id]);
			expect(listedBByPath.items.map((item) => item.id)).toEqual([sessionB.id]);
			expect(sessionA.id).not.toBe(sessionB.id);
		} finally {
			await restoreEnv();
		}
	});
});
