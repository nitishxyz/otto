import { getAuth } from '../auth/src/index.ts';
import type { JudgeProviderId, JudgeSettings } from './types.ts';

export const JUDGE_PROVIDER_ID: JudgeProviderId = 'typesafe';
export const JUDGE_ENV_VAR = 'TYPESAFE_API_KEY';
export const JUDGE_DEFAULT_BASE_URL = 'https://api.typesafe.ai';
export const JUDGE_DEFAULT_MODEL = 'jev-latest';
export const JUDGE_DEFAULT_TIMEOUT_MS = 4_000;
export const JUDGE_DEFAULT_PRELOAD_THRESHOLD = 0.5;

export type ResolvedJudgeConfig = {
	enabled: boolean;
	provider: JudgeProviderId;
	baseURL: string;
	model: string;
	apiKey: string | undefined;
	timeoutMs: number;
	mcp: {
		classifyTools: boolean;
		preloadTools: boolean;
		preloadThreshold: number;
	};
};

/** Read the judge API key from the environment without touching disk. */
export function readJudgeEnvKey(): string | undefined {
	const value =
		typeof process !== 'undefined' ? process.env[JUDGE_ENV_VAR] : undefined;
	return value?.length ? value : undefined;
}

function clamp01(value: number | undefined, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(1, Math.max(0, value));
}

function normalizeBaseURL(value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) return JUDGE_DEFAULT_BASE_URL;
	return trimmed.replace(/\/+$/, '');
}

/**
 * Resolve effective judge configuration from settings, environment, and the
 * secure auth store. Credentials resolve env-first, then stored auth.
 */
export async function resolveJudgeConfig(
	settings: JudgeSettings | undefined,
	projectRoot?: string,
): Promise<ResolvedJudgeConfig> {
	const provider = settings?.provider ?? JUDGE_PROVIDER_ID;
	let apiKey = readJudgeEnvKey();
	if (!apiKey) {
		const stored = await getAuth(provider, projectRoot).catch(() => undefined);
		if (stored?.type === 'api' && stored.key) apiKey = stored.key;
	}
	const enabled = settings?.enabled ?? true;
	return {
		enabled,
		provider,
		baseURL: normalizeBaseURL(settings?.baseURL),
		model: settings?.model?.trim() || JUDGE_DEFAULT_MODEL,
		apiKey,
		timeoutMs:
			typeof settings?.timeoutMs === 'number' && settings.timeoutMs > 0
				? settings.timeoutMs
				: JUDGE_DEFAULT_TIMEOUT_MS,
		mcp: {
			classifyTools: settings?.mcp?.classifyTools ?? true,
			preloadTools: settings?.mcp?.preloadTools ?? true,
			preloadThreshold: clamp01(
				settings?.mcp?.preloadThreshold,
				JUDGE_DEFAULT_PRELOAD_THRESHOLD,
			),
		},
	};
}

/** True when the judge can be called: enabled and credentials present. */
export function isJudgeAvailable(config: ResolvedJudgeConfig): boolean {
	return config.enabled && Boolean(config.apiKey);
}
