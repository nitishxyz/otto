/**
 * Judge: typed, calibrated decisions from a System One model (TypeSafe Jev).
 *
 * A judge does not generate text. It evaluates `state` against a map of typed
 * questions and returns one answer per question with probabilities. Code owns
 * policy; the judge supplies semantic understanding where heuristics fall short.
 */

import type { JudgeSettings } from '../types/src/config.ts';

export type { JudgeSettings };
export type JudgeProviderId = NonNullable<JudgeSettings['provider']>;

export type NoulQuestion = {
	type: 'noul';
	instructions: string;
	criteria?: { true?: string; false?: string };
};

export type ChoiceQuestion<K extends string = string> = {
	type: 'choice';
	instructions: string;
	criteria: Record<K, string | null>;
};

export type ScoreQuestion = {
	type: 'score';
	instructions: string;
	criteria: readonly [string, string, ...string[]];
};

export type JudgeQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: 'noul'; noul: number };

export type ChoiceAnswer<K extends string = string> = {
	type: 'choice';
	choice: K;
	probabilities: Record<K, number>;
	confidence: number;
};

export type ScoreAnswer = {
	type: 'score';
	score: number;
	legend: Record<string, string>;
	probabilities: Record<string, number>;
	confidence: number;
};

export type JudgeAnswerFor<Q extends JudgeQuestion> = Q extends NoulQuestion
	? NoulAnswer
	: Q extends ChoiceQuestion<infer K>
		? ChoiceAnswer<K>
		: Q extends ScoreQuestion
			? ScoreAnswer
			: never;

export type JudgeAnswers<Q extends Record<string, JudgeQuestion>> = {
	[K in keyof Q]: JudgeAnswerFor<Q[K]>;
};

export type JudgeUsage = { input_tokens: number; output_tokens: number };

export type JudgeFailureReason =
	| 'unconfigured'
	| 'disabled'
	| 'timeout'
	| 'error';

export type JudgeResult<Q extends Record<string, JudgeQuestion>> =
	| { ok: true; answers: JudgeAnswers<Q>; model: string; usage?: JudgeUsage }
	| { ok: false; reason: JudgeFailureReason; error?: string };

export type JudgeRequest<Q extends Record<string, JudgeQuestion>> = {
	state: unknown;
	questions: Q;
	/** Overrides the configured timeout for this call. */
	timeoutMs?: number;
	signal?: AbortSignal;
};
