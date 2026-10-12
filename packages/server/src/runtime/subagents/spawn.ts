import {
	hasConfiguredProvider,
	isDelegatableAgent,
	logger,
} from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import { discoverAllAgents, resolveAgentConfig } from '../agent/registry.ts';
import { createSession } from '../session/manager.ts';
import { selectProviderAndModel } from '../provider/selection.ts';
import type { DispatchOptions } from '../message/types.ts';
import { dispatchSubagentMessage } from './dispatch.ts';
import { buildSubagentPrompt } from './prompt.ts';
import { resolveReusableChildSession } from './reuse.ts';
import {
	attemptOf,
	checkSpawnCapacity,
	reserveSpawnAttempt,
	subagentAttemptTurnClaim,
	terminateSubagentAttempt,
} from './transitions.ts';
import type { SpawnSubagentInput, SpawnSubagentResult } from './types.ts';

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
		files,
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
	const reserved = reserveSpawnAttempt(db, {
		id: subagentId,
		parentSessionId,
		childSessionId: childSession.id,
		agent: targetAgent,
		task,
	});
	if (!reserved.ok) return { ok: false, error: reserved.error };

	try {
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
			context: files?.length ? { files } : undefined,
			messageOrigin: 'parent-agent',
			memoryTask: task,
			acceptClaim: subagentAttemptTurnClaim(attemptOf(reserved.record)),
		});
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		terminateSubagentAttempt(db, attemptOf(reserved.record), {
			status: 'failed',
			summary: `Failed to dispatch sub-agent task: ${reason}`,
			reported: false,
		});
		logger.warn('[subagent] dispatch failed', { subagentId, error: reason });
		return { ok: false, error: `Failed to start sub-agent: ${reason}` };
	}

	publish({
		type: 'session.updated',
		sessionId: parentSessionId,
		projectRoot: cfg.projectRoot,
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
	if (!isDelegatableAgent(args.targetAgent)) {
		return {
			ok: false,
			error: `Cannot delegate to the ${args.targetAgent} agent.`,
		};
	}

	const knownAgents = await discoverAllAgents(args.cfg.projectRoot);
	if (!knownAgents.includes(args.targetAgent)) {
		return {
			ok: false,
			error: `Unknown agent "${args.targetAgent}". Available agents: ${knownAgents.join(', ')}`,
		};
	}

	return checkSpawnCapacity(args.db, args.parentSessionId);
}
