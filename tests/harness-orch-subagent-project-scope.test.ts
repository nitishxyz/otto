import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, type DB } from '@ottocode/database';
import { sessions, subagents } from '@ottocode/database/schema';
import { loadConfig, type OttoConfig } from '@ottocode/sdk';
import {
	getOrCreateRunnerState,
	deleteRunnerState,
	setMessageAbortController,
	deleteMessageAbortController,
} from '../packages/server/src/runtime/session/queue/state.ts';
import { getSubagentStatus } from '../packages/server/src/runtime/subagents/inspection.ts';
import { reportFinishedSubagents } from '../packages/server/src/runtime/subagents/report.ts';
import { stopSubagent } from '../packages/server/src/runtime/subagents/stop.ts';
import { abortChildSubagents } from '../packages/server/src/runtime/subagents/abort.ts';

const parent = 'scope-parent';
const child = 'scope-child';
const roots: string[] = [];
const databases: DB[] = [];
const configs: OttoConfig[] = [];
const controllers = [new AbortController(), new AbortController()];

beforeAll(async () => {
	for (let index = 0; index < 2; index++) {
		const root = await mkdtemp(join(tmpdir(), 'otto-subagent-project-scope-'));
		roots.push(root);
		const db = await getDb(root);
		databases.push(db);
		configs.push(await loadConfig(root));
		for (const id of [parent, child]) {
			await db.insert(sessions).values({
				id,
				projectPath: root,
				agent: 'build',
				provider: 'openai',
				model: 'gpt-4o-mini',
				createdAt: Date.now(),
				...(id === child
					? { parentSessionId: parent, sessionType: 'subagent' as const }
					: {}),
			});
		}
		await db.insert(subagents).values({
			id: 'scope-agent',
			parentSessionId: parent,
			childSessionId: child,
			agent: 'build',
			task: 'scope isolation',
			status: 'running',
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		getOrCreateRunnerState(parent, root).running = true;
		const state = getOrCreateRunnerState(child, root);
		state.running = true;
		state.currentMessageId = `message-${index}`;
		setMessageAbortController(state.currentMessageId, controllers[index], root);
	}
});

afterAll(async () => {
	for (const root of roots) {
		deleteRunnerState(parent, root);
		deleteRunnerState(child, root);
		deleteMessageAbortController(`message-${roots.indexOf(root)}`, root);
		await rm(root, { recursive: true, force: true });
	}
});

test('subagent consumers isolate identical session IDs across projects', async () => {
	for (let index = 0; index < 2; index++) {
		expect(
			await reportFinishedSubagents(databases[index], configs[index], parent),
		).toBe(false);
		const status = await getSubagentStatus({
			db: databases[index],
			parentSessionId: parent,
			subagentId: 'scope-agent',
		});
		expect(status.ok).toBe(true);
		if (status.ok)
			expect(status.subagent.execution.currentMessageId).toBe(
				`message-${index}`,
			);
	}
	const stopped = await stopSubagent({
		db: databases[0],
		parentSessionId: parent,
		subagentId: 'scope-agent',
		projectRoot: roots[0],
	});
	expect(stopped.ok).toBe(true);
	expect(controllers[0].signal.aborted).toBe(true);
	expect(controllers[1].signal.aborted).toBe(false);
	await expect(
		abortChildSubagents(databases[1], parent),
	).resolves.toBeUndefined();
	expect(controllers[1].signal.aborted).toBe(true);
});
