import type { ModelInfo } from '../../types/src/index.ts';

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
export function mergeModelLists(
	baseModels: ModelInfo[] | undefined,
	cachedModels: ModelInfo[] | undefined,
): ModelInfo[] {
	const base = baseModels ?? [];
	const cached = (cachedModels ?? []).map(normalizeModelInfo);
	if (!cached.length) return base;
	if (!base.length) return cached;
	const cachedById = new Map(cached.map((model) => [model.id, model]));
	const merged = base.map((model) => {
		const override = cachedById.get(model.id);
		return override ? { ...model, ...override } : model;
	});
	const baseIds = new Set(base.map((model) => model.id));
	const extras = cached.filter((model) => !baseIds.has(model.id));
	return extras.length ? [...merged, ...extras] : merged;
}
