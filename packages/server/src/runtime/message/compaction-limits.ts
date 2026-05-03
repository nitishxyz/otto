import { catalog, getModelInfo } from '@ottocode/sdk';
import type { BuiltInProviderId, ProviderId } from '@ottocode/sdk';

export const PRUNE_PROTECT = 40_000;

export function estimateTokens(text: string): number {
	return Math.max(0, Math.round((text || '').length / 4));
}

export interface ModelLimits {
	context: number;
	output: number;
}

export function shouldAutoCompactBeforeOverflow(args: {
	autoCompactThresholdTokens?: number | null;
	currentContextTokens?: number | null;
	estimatedInputTokens?: number | null;
	isCompactCommand?: boolean;
	compactionRetries?: number;
}): boolean {
	const threshold = Number(args.autoCompactThresholdTokens ?? 0);
	if (!Number.isFinite(threshold) || threshold <= 0) {
		return false;
	}
	if (args.isCompactCommand) {
		return false;
	}
	if ((args.compactionRetries ?? 0) > 0) {
		return false;
	}

	const currentContextTokens = Math.max(
		0,
		Math.floor(Number(args.currentContextTokens ?? 0)),
	);
	if (currentContextTokens <= 0) {
		return false;
	}

	const estimatedInputTokens = Math.max(
		0,
		Math.floor(Number(args.estimatedInputTokens ?? 0)),
	);

	return currentContextTokens + estimatedInputTokens >= threshold;
}

export function getModelLimits(
	provider: string,
	model: string,
): ModelLimits | null {
	const info = getModelInfo(provider as ProviderId, model);
	if (info?.limit?.context && info?.limit?.output) {
		return { context: info.limit.context, output: info.limit.output };
	}
	for (const key of Object.keys(catalog) as BuiltInProviderId[]) {
		const entry = catalog[key];
		const m = entry?.models?.find((x: { id: string }) => x.id === model);
		if (m?.limit?.context && m?.limit?.output) {
			return { context: m.limit.context, output: m.limit.output };
		}
	}
	return null;
}

export function isCompacted(part: { compactedAt?: number | null }): boolean {
	return !!part.compactedAt;
}

export const COMPACTED_PLACEHOLDER = '[Compacted]';
