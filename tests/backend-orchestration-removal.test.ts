import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { createApp } from '../packages/server/src/index.ts';
import {
	createSessionBodySchema,
	listSessionsQuerySchema,
} from '../packages/server/src/routes/sessions/crud/schemas.ts';
import { BUILTIN_AGENT_NAMES } from '../packages/server/src/runtime/agent/registry/descriptions.ts';
import { listSessions } from '../packages/server/src/runtime/session/manager.ts';

let projectRoot: string | undefined;

afterEach(async () => {
	if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
	projectRoot = undefined;
});

describe('direct backend orchestration', () => {
	test('does not register the removed orchestrator or accept its session type', () => {
		expect(BUILTIN_AGENT_NAMES).toEqual([
			'build',
			'plan',
			'general',
			'research',
		]);
		expect(
			createSessionBodySchema.safeParse({ sessionType: 'looper' }).success,
		).toBe(false);
		expect(
			createSessionBodySchema.safeParse({ sessionType: 'main' }).success,
		).toBe(true);
		expect(listSessionsQuerySchema.shape).not.toHaveProperty('sessionType');
	});

	test('does not mount goal routes', async () => {
		const app = createApp();
		for (const path of ['/v1/goals', '/v1/sessions/legacy/goal']) {
			const response = await app.request(path);
			expect(response.status).toBe(404);
		}
	});

	test('keeps legacy orchestrator sessions hidden from default listings', async () => {
		projectRoot = await mkdtemp(join(tmpdir(), 'otto-orchestration-removal-'));
		const db = await getDb(projectRoot);
		await db.insert(sessions).values([
			{
				id: 'main',
				agent: 'build',
				provider: 'openai',
				model: 'test',
				projectPath: projectRoot,
				createdAt: Date.now(),
				sessionType: 'main',
			},
			{
				id: 'legacy',
				agent: 'looper',
				provider: 'openai',
				model: 'test',
				projectPath: projectRoot,
				createdAt: Date.now(),
				sessionType: 'looper',
			},
		]);
		for (const projectPath of [projectRoot, undefined]) {
			const rows = await listSessions({ db, projectPath });
			expect(rows.map((row) => row.id)).toEqual(['main']);
		}
		expect(await db.select().from(sessions)).toHaveLength(2);
	});
});
