import { and, eq } from 'drizzle-orm';
import { hasConfiguredProvider, logger } from '@ottocode/sdk';
import { subagents } from '@ottocode/database/schema';
import { publish } from '../../events/bus.ts';
import { discoverAllAgents, resolveAgentConfig } from '../agent/registry.ts';
import { createSession } from '../session/manager.ts';
import { selectProviderAndModel } from '../provider/selection.ts';
import type { DispatchOptions } from '../message/types.ts';
import { dispatchSubagentMessage } from './dispatch.ts';
import { buildSubagentPrompt } from './prompt.ts';
import { resolveReusableChildSession } from './reuse.ts';
import {
	MAX_CONCURRENT_PER_PARENT,
	type SpawnSubagentInput,
	type SpawnSubagentResult,
} from './types.ts';

/**
 * Spawns an async sub-agent run in a new child session, or resumes an
 * existing child session when reuseSessionId is provided.
 */
export async function spawnSubagent(
	input: SpawnSubagentInput,
): Promise<SpawnSubagentResult> {
	const {
		db,
		cfg,
		parentSessionId,
		parentAgent,
		agent,
		task,
		context,
		reuseSessionId,
	} = input;

	const targetAgent = agent.trim();
	const validation = await validateSpawnTarget({
		cfg,
		db,
		parentSessionId,
		parentAgent,
		targetAgent,
	});
	if (!validation.ok) return validation;

	let childSession: DispatchOptions['session'];
	let isReuse = false;
	if (reuseSessionId) {
		const reuse = await resolveReusableChildSession({
			db,
			parentSessionId,
			targetAgent,
			reuseSessionId,
		});
		if (!reuse.ok) return { ok: false, error: reuse.error };
		childSession = reuse.session;
		isReuse = true;
	} else {
		const agentCfg = await resolveAgentConfig(cfg.projectRoot, targetAgent);
		const agentProviderDefault = hasConfiguredProvider(cfg, agentCfg.provider)
			? agentCfg.provider
			: cfg.defaults.provider;
		const agentModelDefault = agentCfg.model ?? cfg.defaults.model;
		const selection = await selectProviderAndModel({
			cfg,
			agentProviderDefault,
			agentModelDefault,
		});
		childSession = await createSession({
			db,
			cfg,
			agent: targetAgent,
			provider: selection.provider,
			model: selection.model,
			title: `Sub-agent: ${task.slice(0, 60)}`,
			parentSessionId,
			sessionType: 'subagent',
		});
	}

	const subagentId = crypto.randomUUID();
	const now = Date.now();
	await db.insert(subagents).values({
		id: subagentId,
		parentSessionId,
		childSessionId: childSession.id,
		agent: targetAgent,
		task,
		status: 'running',
		summary: null,
		reported: false,
		createdAt: now,
		updatedAt: now,
	});

	await dispatchSubagentMessage({
		cfg,
		db,
		session: childSession,
		agent: targetAgent,
		content: buildSubagentPrompt({
			parentSessionId,
			parentAgent,
			task,
			context,
			isReuse,
		}),
	});

	publish({
		type: 'session.updated',
		sessionId: parentSessionId,
		payload: {
			id: parentSessionId,
			subagentSpawned: {
				subagentId,
				childSessionId: childSession.id,
				agent: targetAgent,
			},
		},
	});

	logger.info('[subagent] spawned', {
		subagentId,
		parentSessionId,
		childSessionId: childSession.id,
		agent: targetAgent,
		provider: childSession.provider,
		model: childSession.model,
		reused: isReuse,
	});

	return {
		ok: true,
		subagentId,
		childSessionId: childSession.id,
		agent: targetAgent,
	};
}

async function validateSpawnTarget(args: {
	cfg: SpawnSubagentInput['cfg'];
	db: SpawnSubagentInput['db'];
	parentSessionId: string;
	parentAgent: string;
	targetAgent: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!args.targetAgent)
		return { ok: false, error: 'Target agent is required.' };
	if (args.targetAgent === args.parentAgent) {
		return {
			ok: false,
			error: 'Cannot delegate to the same agent that is delegating.',
		};
	}
	if (args.targetAgent === 'otto') {
		return { ok: false, error: 'Cannot delegate to the otto agent.' };
	}

	const knownAgents = await discoverAllAgents(args.cfg.projectRoot);
	if (!knownAgents.includes(args.targetAgent)) {
		return {
			ok: false,
			error: `Unknown agent "${args.targetAgent}". Available agents: ${knownAgents.join(', ')}`,
		};
	}

	const running = await args.db
		.select({ id: subagents.id })
		.from(subagents)
		.where(
			and(
				eq(subagents.parentSessionId, args.parentSessionId),
				eq(subagents.status, 'running'),
			),
		);
	if (running.length >= MAX_CONCURRENT_PER_PARENT) {
		return {
			ok: false,
			error: `Too many running sub-agents (max ${MAX_CONCURRENT_PER_PARENT}). Wait for one to finish or check list_subagents.`,
		};
	}

	return { ok: true };
}
