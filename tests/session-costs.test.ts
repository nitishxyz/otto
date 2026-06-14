import { afterEach, describe, expect, test } from 'bun:test';
import { getDb } from '@ottocode/database';
import { messages, sessions } from '@ottocode/database/schema';
import { estimateModelCostUsd, loadConfig } from '@ottocode/sdk';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSessionCostSummaries } from '../packages/server/src/routes/sessions/service.ts';

let projectRoot: string | undefined;
let ottoHome: string | undefined;
let previousOttoHome: string | undefined;

afterEach(async () => {
	if (previousOttoHome === undefined) {
		delete process.env.OTTO_HOME;
	} else {
		process.env.OTTO_HOME = previousOttoHome;
	}
	previousOttoHome = undefined;
	if (ottoHome) await rm(ottoHome, { recursive: true, force: true });
	ottoHome = undefined;
	if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
	projectRoot = undefined;
});

describe('session cost summaries', () => {
	test('attributes direct sub-agent costs to the parent session', async () => {
		projectRoot = await mkdtemp(join(tmpdir(), 'otto-session-costs-'));
		ottoHome = await mkdtemp(join(tmpdir(), 'otto-session-costs-home-'));
		previousOttoHome = process.env.OTTO_HOME;
		process.env.OTTO_HOME = ottoHome;
		const db = await getDb(projectRoot);
		const cfg = await loadConfig(projectRoot);
		const now = Date.now();

		await db.insert(sessions).values([
			{
				id: 'parent',
				agent: 'otto',
				provider: 'openai',
				model: 'gpt-4o-mini',
				projectPath: cfg.projectRoot,
				createdAt: now,
				sessionType: 'otto',
			},
			{
				id: 'child',
				agent: 'frontend',
				provider: 'anthropic',
				model: 'claude-3-haiku-20240307',
				projectPath: cfg.projectRoot,
				createdAt: now,
				parentSessionId: 'parent',
				sessionType: 'subagent',
			},
		]);
		await db.insert(messages).values([
			{
				id: 'parent-assistant',
				sessionId: 'parent',
				role: 'assistant',
				status: 'complete',
				agent: 'otto',
				provider: 'openai',
				model: 'gpt-4o-mini',
				createdAt: now,
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			},
			{
				id: 'child-assistant',
				sessionId: 'child',
				role: 'assistant',
				status: 'complete',
				agent: 'frontend',
				provider: 'anthropic',
				model: 'claude-3-haiku-20240307',
				createdAt: now + 1,
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			},
		]);

		const rows = await db.select().from(sessions);
		const costs = await getSessionCostSummaries(db, rows);
		const parentCost = estimateModelCostUsd('openai', 'gpt-4o-mini', {
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
		});
		const childCost = estimateModelCostUsd(
			'anthropic',
			'claude-3-haiku-20240307',
			{
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			},
		);

		expect(parentCost).toBeDefined();
		expect(childCost).toBeDefined();
		expect(costs.get('parent')).toEqual({
			ownCostUsd: parentCost,
			subagentCostUsd: childCost,
			totalCostUsd: Number(((parentCost ?? 0) + (childCost ?? 0)).toFixed(6)),
		});
		expect(costs.get('child')).toEqual({
			ownCostUsd: childCost,
			subagentCostUsd: 0,
			totalCostUsd: childCost,
		});
	});
});
