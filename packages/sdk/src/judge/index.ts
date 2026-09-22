import { JudgeClient, type JudgeFetch } from './client.ts';
import {
	isJudgeAvailable,
	resolveJudgeConfig,
	type ResolvedJudgeConfig,
} from './config.ts';
import type {
	ChoiceQuestion,
	JudgeSettings,
	NoulQuestion,
	ScoreQuestion,
} from './types.ts';

export type * from './types.ts';
export { JudgeClient, type JudgeFetch } from './client.ts';
export {
	JUDGE_DEFAULT_BASE_URL,
	JUDGE_DEFAULT_MODEL,
	JUDGE_DEFAULT_PRELOAD_THRESHOLD,
	JUDGE_DEFAULT_TIMEOUT_MS,
	JUDGE_ENV_VAR,
	JUDGE_PROVIDER_ID,
	isJudgeAvailable,
	readJudgeEnvKey,
	resolveJudgeConfig,
	type ResolvedJudgeConfig,
} from './config.ts';

/** Yes/no question. The answer is the probability of "yes". */
export function noul(
	instructions: string,
	criteria?: NoulQuestion['criteria'],
): NoulQuestion {
	return criteria
		? { type: 'noul', instructions, criteria }
		: { type: 'noul', instructions };
}

/** Pick one option from a fixed set. Use `null` when an option needs no rubric. */
export function choice<const K extends string>(
	instructions: string,
	criteria: Record<K, string | null>,
): ChoiceQuestion<K> {
	return { type: 'choice', instructions, criteria };
}

/** Rate along ordered levels; the answer can land between levels. */
export function score(
	instructions: string,
	criteria: ScoreQuestion['criteria'],
): ScoreQuestion {
	return { type: 'score', instructions, criteria };
}

type JudgeFactoryOptions = {
	settings?: JudgeSettings;
	projectRoot?: string;
	fetchImpl?: JudgeFetch;
};

/**
 * Build a judge client for the given settings. Returns `null` when the judge
 * is disabled or has no credentials so callers can short-circuit cheaply.
 */
export async function createJudge(
	options: JudgeFactoryOptions = {},
): Promise<JudgeClient | null> {
	const config = await resolveJudgeConfig(
		options.settings,
		options.projectRoot,
	);
	if (!isJudgeAvailable(config)) return null;
	return new JudgeClient(config, options.fetchImpl);
}

/** Build a judge client from an already-resolved config (tests, callers with cached config). */
export function createJudgeFromConfig(
	config: ResolvedJudgeConfig,
	fetchImpl?: JudgeFetch,
): JudgeClient | null {
	if (!isJudgeAvailable(config)) return null;
	return new JudgeClient(config, fetchImpl);
}
