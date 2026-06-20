import type { ModelInfo, ModelInfoMap } from '../../types/src/index.ts';

export function modelListToMap(models: readonly ModelInfo[]): ModelInfoMap {
	const result: ModelInfoMap = {};
	for (const model of models) {
		if (!model.id.trim()) continue;
		result[model.id] = model;
	}
	return result;
}

export function modelMapToList(models: ModelInfoMap): ModelInfo[] {
	return Object.values(models);
}

export function getModelFromMap(
	models: ModelInfoMap | undefined,
	id: string | undefined,
): ModelInfo | undefined {
	if (!models || !id) return undefined;
	return models[id];
}

export function hasModelInMap(
	models: ModelInfoMap | undefined,
	id: string | undefined,
): boolean {
	return getModelFromMap(models, id) !== undefined;
}

export function mapConfiguredModelEntries(
	models: ModelInfoMap | undefined,
): ModelInfoMap {
	const result: ModelInfoMap = {};
	if (!models) return result;
	for (const [id, model] of Object.entries(models)) {
		const normalizedId = id.trim();
		if (!normalizedId) continue;
		result[normalizedId] = { ...model, id: normalizedId };
	}
	return result;
}
