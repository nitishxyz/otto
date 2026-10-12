import { expect, test } from 'bun:test';
import { sessions } from '@ottocode/database/schema';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAPIHono } from '@hono/zod-openapi';
import { registerSessionQueueStatusRoute } from '../packages/server/src/routes/sessions/queue/status';
import { registerAbortSessionRoute } from '../packages/server/src/routes/sessions/queue/abort';
import { registerMarkSessionViewedRoute } from '../packages/server/src/routes/sessions/crud/viewed';
import { registerRemoveQueuedMessageRoute } from '../packages/server/src/routes/sessions/queue/remove';
import { registerSendQueuedMessageNowRoute } from '../packages/server/src/routes/sessions/queue/send-now';
import { getProjectManager } from '../packages/server/src/runtime/projects/manager';
import {
	deleteRunnerState,
	getOrCreateRunnerState,
} from '../packages/server/src/runtime/session/queue/state';

test('queue and working-state routes isolate the same session ID by canonical request project', async () => {
	const root = await mkdtemp(join(tmpdir(), 'otto-route-scope-'));
	const previousConfig = process.env.XDG_CONFIG_HOME;
	const previousData = process.env.XDG_DATA_HOME;
	process.env.XDG_CONFIG_HOME = join(root, 'config');
	process.env.XDG_DATA_HOME = join(root, 'data');
	const manager = getProjectManager();
	const id = crypto.randomUUID();
	const projects = [];
	try {
		for (const name of ['a', 'b']) {
			const path = join(root, name);
			await mkdir(path);
			const project = await manager.openProject({ path });
			projects.push(project);
			await project.db.insert(sessions).values({
				id,
				agent: 'build',
				provider: 'openai',
				model: 'gpt-4o',
				projectPath: project.root,
				createdAt: Date.now(),
			});
			const state = getOrCreateRunnerState(id, project.root);
			state.running = name === 'a';
			state.currentMessageId = name;
			state.queue.push({
				sessionId: id,
				assistantMessageId: 'queued',
				agent: 'build',
				provider: 'openai',
				model: 'gpt-4o',
				projectRoot: project.root,
				oneShot: false,
				toolApprovalMode: 'auto',
			});
		}
		await symlink(projects[0].root, join(root, 'alias'));
		const app = new OpenAPIHono();
		registerSessionQueueStatusRoute(app);
		registerMarkSessionViewedRoute(app);
		registerRemoveQueuedMessageRoute(app);
		registerSendQueuedMessageNowRoute(app);
		registerAbortSessionRoute(app);
		for (const [index, project] of projects.entries()) {
			const query = `project=${encodeURIComponent(index === 0 ? join(root, 'alias') : project.root)}`;
			const queue = await app.request(`/v1/sessions/${id}/queue?${query}`);
			expect(queue.status).toBe(200);
			expect(await queue.json()).toMatchObject({
				currentMessageId: index === 0 ? 'a' : 'b',
				isRunning: index === 0,
			});
			const viewed = await app.request(`/v1/sessions/${id}/viewed?${query}`, {
				method: 'POST',
			});
			expect(viewed.status).toBe(200);
			expect(await viewed.json()).toMatchObject({ isRunning: index === 0 });
			const send = await app.request(
				`/v1/sessions/${id}/queue/${index === 0 ? 'a' : 'b'}/send-now?${query}`,
				{ method: 'POST' },
			);
			expect(send.status).toBe(200);
		}
		const removed = await app.request(
			`/v1/sessions/${id}/queue/queued?project=${encodeURIComponent(projects[0].root)}`,
			{ method: 'DELETE' },
		);
		expect(removed.status).toBe(200);
		expect(getOrCreateRunnerState(id, projects[0].root).queue).toHaveLength(0);
		expect(getOrCreateRunnerState(id, projects[1].root).queue).toHaveLength(1);
		const abortMessage = await app.request(
			`/v1/sessions/${id}/abort?project=${encodeURIComponent(join(root, 'alias'))}`,
			{
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messageId: 'a' }),
			},
		);
		expect(abortMessage.status).toBe(200);
		expect(await abortMessage.json()).toMatchObject({
			success: true,
			wasRunning: true,
		});
		const abortSession = await app.request(
			`/v1/sessions/${id}/abort?project=${encodeURIComponent(join(root, 'alias'))}`,
			{
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clearQueue: true }),
			},
		);
		expect(abortSession.status).toBe(200);
		expect(getOrCreateRunnerState(id, projects[1].root).queue).toHaveLength(1);
	} finally {
		for (const project of projects) {
			deleteRunnerState(id, project.root);
			await manager.closeProject(project.id);
		}
		if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = previousConfig;
		if (previousData === undefined) delete process.env.XDG_DATA_HOME;
		else process.env.XDG_DATA_HOME = previousData;
		await rm(root, { recursive: true, force: true });
	}
});
