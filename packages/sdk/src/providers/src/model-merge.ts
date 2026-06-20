import type { ModelInfo, ModelInfoMap } from '../../types/src/index.ts';

function normalizeModelInfo(model: ModelInfo): ModelInfo {
	return (model.ownedBy as string | undefined) === 'moonshot'
		? { ...model, ownedBy: 'kimi' }
		: model;
}

/**
 * Merge embedded/manual catalog models with cached (remote/local) models by id.
 *
 * Cached entries override fields for overlapping ids (so remote updates like
 * pricing/limits still apply), while embedded/manual-only models (for example
 * the manual xai grok-cli models) are always retained even when a stale cache
 * does not include them.
 */
export function mergeModelMaps(
	baseModels: ModelInfoMap | undefined,
	cachedModels: ModelInfoMap | undefined,
): ModelInfoMap {
	const merged: ModelInfoMap = { ...(baseModels ?? {}) };
	for (const [id, model] of Object.entries(cachedModels ?? {})) {
		const normalized = normalizeModelInfo({ ...model, id });
		merged[id] = merged[id] ? { ...merged[id], ...normalized } : normalized;
	}
	return merged;
}
