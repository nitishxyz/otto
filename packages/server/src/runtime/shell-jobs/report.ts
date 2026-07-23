import { getDb } from '@ottocode/database';
import {
	loadConfig,
	logger,
	type OttoConfig,
	type ProviderId,
} from '@ottocode/sdk';
import type { DB } from '@ottocode/database';
import { getSessionById } from '../session/manager.ts';
import { getRunnerState } from '../session/queue.ts';
import {
	claimFinishedShellJobs,
	markShellJobsReported,
	releaseClaimedShellJobs,
} from '../tools/active-shells.ts';
import { buildShellJobResultsPrompt } from './prompt.ts';

export async function reportFinishedShellJobs(
	db: DB,
	cfg: OttoConfig,
	sessionId: string,
): Promise<boolean> {
	const state = getRunnerState(sessionId);
	if (state && (state.running || state.queue.length > 0)) return false;

	const jobs = claimFinishedShellJobs(sessionId);
	if (!jobs.length) return false;
	const jobIds = jobs.map((job) => job.id);
	try {
		const session = await getSessionById({ db, sessionId });
		if (!session) {
			releaseClaimedShellJobs(jobIds);
			return false;
		}
		const { dispatchAssistantMessage } = await import('../message/service.ts');
		await dispatchAssistantMessage({
			cfg,
			db,
			session,
			agent: session.agent,
			provider: session.provider as ProviderId,
			model: session.model,
			content: buildShellJobResultsPrompt(jobs),
		});
		markShellJobsReported(jobIds);
		logger.info('[shell] reported detached results', {
			sessionId,
			count: jobs.length,
		});
		return true;
	} catch (error) {
		releaseClaimedShellJobs(jobIds);
		throw error;
	}
}

export async function reportFinishedShellJobsWhenIdle(
	sessionId: string,
	projectRoot?: string,
): Promise<void> {
	try {
		if (!projectRoot) return;
		const cfg = await loadConfig(projectRoot);
		const db = await getDb(cfg.projectRoot);
		await reportFinishedShellJobs(db, cfg, sessionId);
	} catch (error) {
		logger.warn('[shell] failed to report detached results', {
			sessionId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
