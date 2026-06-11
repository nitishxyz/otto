import {
	ottorouterCatalog,
	type OttoRouterModelCatalogEntry,
} from '@ottorouter/ai-sdk';
import type {
	BuiltInProviderId,
	ModelInfo,
	ModelOwner,
	ProviderCatalogEntry,
} from '../../types/src/index.ts';

type CatalogMap = Partial<Record<BuiltInProviderId, ProviderCatalogEntry>>;

const OLLAMA_CLOUD_ID: BuiltInProviderId = 'ollama-cloud';
const OTTOROUTER_ID: BuiltInProviderId = 'ottorouter';

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
	moonshot: '@ai-sdk/openai-compatible',
	qwen: '@ai-sdk/openai-compatible',
	zai: '@ai-sdk/openai-compatible',
	minimax: '@ai-sdk/anthropic',
};

function convertOttoRouterModel(m: OttoRouterModelCatalogEntry): ModelInfo {
	const ownedBy = m.owned_by as ModelOwner;
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

export function mergeManualCatalog(
	base: CatalogMap,
): Record<BuiltInProviderId, ProviderCatalogEntry> {
	const ollamaCloudEntry = base[OLLAMA_CLOUD_ID] ?? buildOllamaCloudEntry();
	const manualEntry = buildOttoRouterEntry();
	const merged: Record<BuiltInProviderId, ProviderCatalogEntry> = {
		...(base as Record<BuiltInProviderId, ProviderCatalogEntry>),
	};
	merged[OLLAMA_CLOUD_ID] = ollamaCloudEntry;
	const xaiEntry = appendXaiGrokCliModels(merged.xai);
	if (xaiEntry) {
		merged.xai = xaiEntry;
	}
	if (manualEntry) {
		merged[OTTOROUTER_ID] = manualEntry;
	}
	return merged;
}
