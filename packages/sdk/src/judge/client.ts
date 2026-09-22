import { abortableDelay } from '../runtime/retry.ts';
import { isJudgeAvailable, type ResolvedJudgeConfig } from './config.ts';
import type {
	JudgeAnswers,
	JudgeQuestion,
	JudgeRequest,
	JudgeResult,
	JudgeUsage,
} from './types.ts';

export type JudgeFetch = (
	input: string,
	init: RequestInit,
) => Promise<Response>;

const RETRYABLE_STATUSES = new Set([429, 529]);
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 300;

type RawResponse = {
	model?: string;
	answers?: Record<string, unknown>;
	usage?: JudgeUsage;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateAnswers<Q extends Record<string, JudgeQuestion>>(
	questions: Q,
	raw: unknown,
): JudgeAnswers<Q> | undefined {
	if (!isRecord(raw)) return undefined;
	for (const [id, question] of Object.entries(questions)) {
		const answer = raw[id];
		if (!isRecord(answer) || answer.type !== question.type) return undefined;
		if (question.type === 'noul' && typeof answer.noul !== 'number')
			return undefined;
		if (question.type === 'choice' && typeof answer.choice !== 'string')
			return undefined;
		if (question.type === 'score' && typeof answer.score !== 'number')
			return undefined;
	}
	return raw as JudgeAnswers<Q>;
}

async function readErrorMessage(response: Response): Promise<string> {
	try {
		const text = await response.text();
		return text
			? `${response.status}: ${text.slice(0, 200)}`
			: String(response.status);
	} catch {
		return String(response.status);
	}
}

/**
 * Judge client bound to a resolved configuration. Never throws: every failure
 * surfaces as `{ ok: false }` so callers fall back to their default behavior.
 */
export class JudgeClient {
	constructor(
		private readonly config: ResolvedJudgeConfig,
		private readonly fetchImpl: JudgeFetch = (input, init) =>
			fetch(input, init),
	) {}

	get available(): boolean {
		return isJudgeAvailable(this.config);
	}

	get model(): string {
		return this.config.model;
	}

	async judge<Q extends Record<string, JudgeQuestion>>(
		request: JudgeRequest<Q>,
	): Promise<JudgeResult<Q>> {
		if (!this.config.enabled) return { ok: false, reason: 'disabled' };
		if (!this.config.apiKey) return { ok: false, reason: 'unconfigured' };
		if (Object.keys(request.questions).length === 0) {
			return {
				ok: true,
				answers: {} as JudgeAnswers<Q>,
				model: this.config.model,
			};
		}

		const timeoutMs = request.timeoutMs ?? this.config.timeoutMs;
		const body = JSON.stringify({
			state: request.state,
			model: this.config.model,
			questions: request.questions,
		});

		let lastError: string | undefined;
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			const onOuterAbort = () => controller.abort();
			request.signal?.addEventListener('abort', onOuterAbort, { once: true });
			try {
				const response = await this.fetchImpl(
					`${this.config.baseURL}/v1/systemone`,
					{
						method: 'POST',
						headers: {
							Authorization: `Bearer ${this.config.apiKey}`,
							'Content-Type': 'application/json',
						},
						body,
						signal: controller.signal,
					},
				);
				if (!response.ok) {
					lastError = await readErrorMessage(response);
					if (
						RETRYABLE_STATUSES.has(response.status) &&
						attempt < MAX_RETRIES
					) {
						await abortableDelay(RETRY_DELAY_MS, request.signal);
						continue;
					}
					return { ok: false, reason: 'error', error: lastError };
				}
				const raw = (await response.json()) as RawResponse;
				const answers = validateAnswers(request.questions, raw.answers);
				if (!answers) {
					return {
						ok: false,
						reason: 'error',
						error: 'Malformed judge response',
					};
				}
				return {
					ok: true,
					answers,
					model: raw.model ?? this.config.model,
					...(raw.usage ? { usage: raw.usage } : {}),
				};
			} catch (error) {
				const aborted = controller.signal.aborted;
				if (request.signal?.aborted) {
					return { ok: false, reason: 'error', error: 'Aborted' };
				}
				if (aborted) return { ok: false, reason: 'timeout' };
				lastError = error instanceof Error ? error.message : String(error);
				if (attempt < MAX_RETRIES) {
					await abortableDelay(RETRY_DELAY_MS, request.signal).catch(() => {});
					continue;
				}
				return { ok: false, reason: 'error', error: lastError };
			} finally {
				clearTimeout(timer);
				request.signal?.removeEventListener('abort', onOuterAbort);
			}
		}
		return { ok: false, reason: 'error', error: lastError };
	}
}
