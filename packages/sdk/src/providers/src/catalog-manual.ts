import {
	ottorouterCatalog,
	type OttoRouterModelCatalogEntry,
} from '@ottorouter/ai-sdk/catalog';
import type {
	BuiltInProviderId,
	ModelInfo,
	ModelOwner,
	ProviderCatalogEntry,
} from '../../types/src/index.ts';

type CatalogMap = Partial<Record<BuiltInProviderId, ProviderCatalogEntry>>;

const OLLAMA_CLOUD_ID: BuiltInProviderId = 'ollama-cloud';
const OTTOROUTER_ID: BuiltInProviderId = 'ottorouter';
const ZAI_ID: BuiltInProviderId = 'zai';
const ZAI_CODING_ID: BuiltInProviderId = 'zai-coding';
const DEEPSEEK_ID: BuiltInProviderId = 'deepseek';

const ZAI_MODEL_ORDER = ['glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-5'];

const ZAI_MANUAL_MODELS: ModelInfo[] = [
	{
		id: 'glm-5.2',
		ownedBy: 'zai',
		label: 'GLM-5.2',
		modalities: { input: ['text'], output: ['text'] },
		toolCall: true,
		reasoningText: true,
		attachment: false,
		temperature: true,
		releaseDate: '2026-06-13',
		lastUpdated: '2026-06-13',
		openWeights: false,
		cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
		limit: { context: 1_000_000, output: 131_072 },
	},
];

const ZAI_CODING_MODEL_ORDER = [
	'glm-5.2',
	'glm-5.1',
	'glm-5-turbo',
	'glm-5',
	'glm-4.7',
	'glm-4.5-air',
	'glm-5v-turbo',
];

const ZAI_CODING_MANUAL_MODELS: ModelInfo[] = [
	{
		id: 'glm-5.2',
		ownedBy: 'zai',
		label: 'GLM-5.2',
		modalities: { input: ['text'], output: ['text'] },
		toolCall: true,
		reasoningText: true,
		attachment: false,
		temperature: true,
		releaseDate: '2026-06-13',
		lastUpdated: '2026-06-13',
		openWeights: false,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		limit: { context: 1_000_000, output: 131_072 },
	},
	{
		id: 'glm-5',
		ownedBy: 'zai',
		label: 'GLM-5',
		modalities: { input: ['text'], output: ['text'] },
		toolCall: true,
		reasoningText: true,
		attachment: false,
		temperature: true,
		releaseDate: '2026-02-11',
		lastUpdated: '2026-02-11',
		openWeights: true,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		limit: { context: 204_800, output: 131_072 },
	},
];

const XAI_GROK_CLI_MODELS: ModelInfo[] = [
	{
		id: 'grok-build',
		ownedBy: 'xai',
		label: 'Grok Build',
		modalities: { input: ['text'], output: ['text'] },
		attachment: false,
		toolCall: true,
		reasoningText: true,
		editToolCapability: 'structured',
		limit: { context: 512_000 },
		provider: { npm: '@ai-sdk/xai' },
	},
	{
		id: 'grok-composer-2.5-fast',
		ownedBy: 'xai',
		label: 'Grok Composer 2.5 Fast',
		modalities: { input: ['text'], output: ['text'] },
		attachment: false,
		toolCall: true,
		reasoningText: true,
		limit: { context: 200_000 },
		provider: { npm: '@ai-sdk/xai' },
	},
];

const OWNER_NPM: Record<ModelOwner, string> = {
	openai: '@ai-sdk/openai',
	anthropic: '@ai-sdk/anthropic',
	google: '@ai-sdk/google',
	openrouter: '@openrouter/ai-sdk-provider',
	xai: '@ai-sdk/xai',
	kimi: '@ai-sdk/openai-compatible',
	qwen: '@ai-sdk/openai-compatible',
	zai: '@ai-sdk/openai-compatible',
	deepseek: '@ai-sdk/openai-compatible',
	minimax: '@ai-sdk/anthropic',
};

function normalizeOttoRouterOwner(owner: string): ModelOwner {
	return owner === 'moonshot' ? 'kimi' : (owner as ModelOwner);
}

function convertOttoRouterModel(m: OttoRouterModelCatalogEntry): ModelInfo {
	const ownedBy = normalizeOttoRouterOwner(m.owned_by);
	return {
		id: m.id,
		ownedBy,
		label: m.name,
		modalities: m.modalities,
		toolCall: m.tool_call,
		reasoningText: m.reasoning,
		attachment: m.attachment,
		temperature: m.temperature,
		knowledge: m.knowledge,
		releaseDate: m.release_date,
		lastUpdated: m.last_updated,
		openWeights: m.open_weights,
		cost: {
			input: m.pricing.input,
			output: m.pricing.output,
			cacheRead: m.pricing.cache_read,
			cacheWrite: m.pricing.cache_write,
		},
		limit: {
			context: m.context_length,
			output: m.max_output,
		},
		provider: {
			npm: OWNER_NPM[ownedBy],
		},
	};
}

function buildOttoRouterEntry(): ProviderCatalogEntry | null {
	const ottorouterModels = ottorouterCatalog.models.map(convertOttoRouterModel);

	if (!ottorouterModels.length) return null;

	ottorouterModels.sort((a, b) => {
		const ownerA = a.ownedBy ?? '';
		const ownerB = b.ownedBy ?? '';
		if (ownerA === ownerB) {
			return a.id.localeCompare(b.id);
		}
		if (ownerA === 'openai') return -1;
		if (ownerB === 'openai') return 1;
		return ownerA.localeCompare(ownerB);
	});

	const defaultModelId = 'gpt-5-codex';
	const defaultIdx = ottorouterModels.findIndex((m) => m.id === defaultModelId);
	if (defaultIdx > 0) {
		const [picked] = ottorouterModels.splice(defaultIdx, 1);
		ottorouterModels.unshift(picked);
	}

	return {
		id: OTTOROUTER_ID,
		label: 'OttoRouter',
		env: ['OTTOROUTER_PRIVATE_KEY'],
		api: 'https://api.ottorouter.org/v1',
		doc: 'https://ottorouter.org/docs',
		models: ottorouterModels,
	};
}

function buildOllamaCloudEntry(): ProviderCatalogEntry {
	return {
		id: OLLAMA_CLOUD_ID,
		label: 'Ollama Cloud',
		env: ['OLLAMA_API_KEY'],
		npm: 'ai-sdk-ollama',
		api: 'https://ollama.com',
		doc: 'https://docs.ollama.com/cloud',
		models: [],
	};
}

export function appendXaiGrokCliModels<T extends { models: ModelInfo[] }>(
	entry: T | undefined,
): T | undefined {
	if (!entry) return undefined;
	const grokCliModelsById = new Map(
		XAI_GROK_CLI_MODELS.map((model) => [model.id, model]),
	);
	const mergedModels = entry.models.map((model) => {
		const override = grokCliModelsById.get(model.id);
		if (!override) return model;
		return {
			...model,
			...override,
			label: model.label ?? override.label,
			cost: model.cost ?? override.cost,
			limit: model.limit ?? override.limit,
		};
	});
	const existingIds = new Set(mergedModels.map((model) => model.id));
	const missingModels = XAI_GROK_CLI_MODELS.filter(
		(model) => !existingIds.has(model.id),
	);
	if (!missingModels.length && mergedModels === entry.models) return entry;
	return { ...entry, models: [...mergedModels, ...missingModels] };
}

const DEPRECATED_KIMI_MODEL_IDS = new Set([
	'kimi-k2-0711-preview',
	'kimi-k2-0905-preview',
	'kimi-k2-thinking',
	'kimi-k2-thinking-turbo',
	'kimi-k2-turbo-preview',
]);

const KIMI_MANUAL_MODELS: ModelInfo[] = [
	{
		id: 'kimi-k2.7-code-highspeed',
		ownedBy: 'kimi',
		label: 'Kimi K2.7 Code Highspeed',
		modalities: { input: ['text', 'image', 'video'], output: ['text'] },
		toolCall: true,
		reasoningText: true,
		attachment: true,
		temperature: false,
		knowledge: '2025-01',
		openWeights: true,
		cost: { input: 1.9, output: 8, cacheRead: 0.38 },
		limit: { context: 262_144, output: 262_144 },
	},
];

const DEEPSEEK_MANUAL_MODELS: ModelInfo[] = [
	{
		id: 'deepseek-v4-flash',
		ownedBy: 'deepseek',
		label: 'DeepSeek V4 Flash',
		modalities: { input: ['text'], output: ['text'] },
		toolCall: true,
		reasoningText: true,
		attachment: false,
		temperature: true,
		knowledge: '2025-05',
		openWeights: true,
		cost: { input: 0.14, output: 0.28, cacheRead: 0.028 },
		limit: { context: 1_000_000, output: 384_000 },
	},
	{
		id: 'deepseek-v4-pro',
		ownedBy: 'deepseek',
		label: 'DeepSeek V4 Pro',
		modalities: { input: ['text'], output: ['text'] },
		toolCall: true,
		reasoningText: true,
		attachment: false,
		temperature: true,
		knowledge: '2025-05',
		openWeights: true,
		cost: { input: 1.74, output: 3.84, cacheRead: 0.145 },
		limit: { context: 1_000_000, output: 384_000 },
	},
	{
		id: 'deepseek-chat',
		ownedBy: 'deepseek',
		label: 'DeepSeek Chat',
		modalities: { input: ['text'], output: ['text'] },
		toolCall: true,
		reasoningText: false,
		attachment: false,
		temperature: true,
		openWeights: true,
		limit: { context: 64_000, output: 8_000 },
	},
	{
		id: 'deepseek-reasoner',
		ownedBy: 'deepseek',
		label: 'DeepSeek Reasoner',
		modalities: { input: ['text'], output: ['text'] },
		toolCall: true,
		reasoningText: true,
		attachment: false,
		temperature: true,
		openWeights: true,
		limit: { context: 64_000, output: 8_000 },
	},
];

export function filterAvailableKimiModels(models: ModelInfo[]): ModelInfo[] {
	return models.filter((model) => !DEPRECATED_KIMI_MODEL_IDS.has(model.id));
}

function appendKimiManualModels(models: ModelInfo[]): ModelInfo[] {
	const manualById = new Map(
		KIMI_MANUAL_MODELS.map((model) => [model.id, model]),
	);
	const mergedModels = models.map((model) => {
		const override = manualById.get(model.id);
		return override ? { ...model, ...override } : model;
	});
	const existingIds = new Set(mergedModels.map((model) => model.id));
	const missingModels = KIMI_MANUAL_MODELS.filter(
		(model) => !existingIds.has(model.id),
	);
	return missingModels.length
		? [...mergedModels, ...missingModels]
		: mergedModels;
}

export function applyOfficialKimiCatalogMetadata<
	T extends ProviderCatalogEntry,
>(entry: T | undefined): T | undefined {
	if (!entry) return undefined;
	const env = Array.from(new Set(['KIMI_API_KEY', ...(entry.env ?? [])]));
	return {
		...entry,
		models: appendKimiManualModels(filterAvailableKimiModels(entry.models)),
		label: 'Kimi',
		env,
		doc: 'https://platform.kimi.ai/docs/api/overview.md',
	};
}

export function applyZaiCatalogMetadata<T extends ProviderCatalogEntry>(
	entry: T | undefined,
): T | undefined {
	if (!entry) return undefined;
	const order = new Map(
		ZAI_MODEL_ORDER.map((modelId, index) => [modelId, index]),
	);
	const modelById = new Map(entry.models.map((model) => [model.id, model]));
	for (const model of ZAI_MANUAL_MODELS) {
		const existing = modelById.get(model.id);
		modelById.set(model.id, existing ? { ...existing, ...model } : model);
	}
	const models = Array.from(modelById.values()).sort((a, b) => {
		const orderA = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
		const orderB = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
		if (orderA !== orderB) return orderA - orderB;
		return a.id.localeCompare(b.id);
	});
	return {
		...entry,
		models,
	};
}

export function applyZaiCodingCatalogMetadata<T extends ProviderCatalogEntry>(
	entry: T | undefined,
): T | undefined {
	if (!entry) return undefined;
	const order = new Map(
		ZAI_CODING_MODEL_ORDER.map((modelId, index) => [modelId, index]),
	);
	const modelById = new Map(entry.models.map((model) => [model.id, model]));
	for (const model of ZAI_CODING_MANUAL_MODELS) {
		if (!modelById.has(model.id)) modelById.set(model.id, model);
	}
	const models = Array.from(modelById.values()).sort((a, b) => {
		const orderA = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
		const orderB = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
		if (orderA !== orderB) return orderA - orderB;
		return a.id.localeCompare(b.id);
	});
	return {
		...entry,
		models,
		label: 'Z.AI Coding Plan',
		env: ['ZAI_CODING_API_KEY'],
		api: 'https://api.z.ai/api/coding/paas/v4',
		doc: 'https://docs.z.ai/devpack/overview',
	};
}

function buildDeepSeekEntry(
	entry: ProviderCatalogEntry | undefined,
): ProviderCatalogEntry {
	const modelById = new Map(
		(entry?.models ?? []).map((model) => [model.id, model]),
	);
	for (const model of DEEPSEEK_MANUAL_MODELS) {
		const existing = modelById.get(model.id);
		modelById.set(model.id, existing ? { ...existing, ...model } : model);
	}
	const models = DEEPSEEK_MANUAL_MODELS.map((model) =>
		modelById.get(model.id),
	).filter((model): model is ModelInfo => Boolean(model));
	for (const model of modelById.values()) {
		if (!models.some((existing) => existing.id === model.id))
			models.push(model);
	}
	return {
		...entry,
		id: DEEPSEEK_ID,
		label: 'DeepSeek',
		env: ['DEEPSEEK_API_KEY'],
		npm: '@ai-sdk/openai-compatible',
		api: 'https://api.deepseek.com',
		doc: 'https://api-docs.deepseek.com/',
		models,
	};
}

export function mergeManualCatalog(
	base: CatalogMap,
): Record<BuiltInProviderId, ProviderCatalogEntry> {
	const ollamaCloudEntry = base[OLLAMA_CLOUD_ID] ?? buildOllamaCloudEntry();
	const manualEntry = buildOttoRouterEntry();
	const deepSeekEntry = buildDeepSeekEntry(base[DEEPSEEK_ID]);
	const merged: Record<BuiltInProviderId, ProviderCatalogEntry> = {
		...(base as Record<BuiltInProviderId, ProviderCatalogEntry>),
	};
	merged[OLLAMA_CLOUD_ID] = ollamaCloudEntry;
	merged[DEEPSEEK_ID] = deepSeekEntry;
	const xaiEntry = appendXaiGrokCliModels(merged.xai);
	if (xaiEntry) {
		merged.xai = xaiEntry;
	}
	const kimiEntry = applyOfficialKimiCatalogMetadata(merged.kimi);
	if (kimiEntry) {
		merged.kimi = kimiEntry;
	}
	const zaiEntry = applyZaiCatalogMetadata(merged[ZAI_ID]);
	if (zaiEntry) {
		merged[ZAI_ID] = zaiEntry;
	}
	const zaiCodingEntry = applyZaiCodingCatalogMetadata(merged[ZAI_CODING_ID]);
	if (zaiCodingEntry) {
		merged[ZAI_CODING_ID] = zaiCodingEntry;
	}
	if (manualEntry) {
		merged[OTTOROUTER_ID] = manualEntry;
	}
	return merged;
}
