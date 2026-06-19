// Fetch models catalog and write to src/providers/catalog.ts
// Usage: bun run scripts/update-catalog.ts [--from path/to/feed.json]

import type {
	BuiltInProviderId,
	ModelInfo,
	ModelOwner,
	ModelProviderBinding,
	ProviderCatalogEntry,
} from '@ottocode/sdk';
import { mergeManualCatalog } from '../packages/sdk/src/providers/src/catalog-manual.ts';

const SOURCE = 'https://models.dev/api.json';
const TARGET = 'packages/sdk/src/providers/src/catalog.ts';
const OTTOROUTER_SOURCE = 'https://api.ottorouter.org/v1/models';
const OTTOROUTER_TARGET = 'packages/ai-sdk/src/catalog.ts';
const REMOTE_CATALOG_TARGET = 'apps/landing/public/catalog/models.json';
const BIOME_JSON_INDENT = '\t';

interface ProviderFeedEntry {
	id: string;
	name?: string;
	env?: unknown;
	npm?: unknown;
	api?: unknown;
	doc?: unknown;
	models: Record<string, unknown>;
}

type ProviderFeed = Record<string, ProviderFeedEntry>;

const SINGLE_PROVIDER_OWNER: Record<string, ModelOwner> = {
	openai: 'openai',
	anthropic: 'anthropic',
	google: 'google',
	moonshotai: 'kimi',
	kimi: 'kimi',
	xai: 'xai',
	zai: 'zai',
	'zai-coding-plan': 'zai',
	deepseek: 'deepseek',
	minimax: 'minimax',
};

const FAMILY_TO_OWNER: Record<string, ModelOwner> = {
	gpt: 'openai',
	'gpt-codex': 'openai',
	'gpt-codex-mini': 'openai',
	'gpt-codex-spark': 'openai',
	'gpt-mini': 'openai',
	'gpt-nano': 'openai',
	'gpt-pro': 'openai',
	'gpt-oss': 'openai',
	o: 'openai',
	'o-mini': 'openai',
	'o-pro': 'openai',
	'text-embedding': 'openai',
	'claude-haiku': 'anthropic',
	'claude-sonnet': 'anthropic',
	'claude-opus': 'anthropic',
	gemini: 'google',
	'gemini-flash': 'google',
	'gemini-flash-lite': 'google',
	'gemini-pro': 'google',
	kimi: 'kimi',
	'kimi-thinking': 'kimi',
	'kimi-free': 'kimi',
	glm: 'zai',
	'glm-air': 'zai',
	'glm-z': 'zai',
	'glm-free': 'zai',
	deepseek: 'deepseek',
	minimax: 'minimax',
	'minimax-free': 'minimax',
	grok: 'xai',
	'grok-code': 'xai',
};

const OWNER_NPM: Partial<Record<ModelOwner, string>> = {
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

function resolveOwnedByFromFamily(
	family: string | undefined,
): ModelOwner | undefined {
	if (!family) return undefined;
	return FAMILY_TO_OWNER[family];
}

function resolveOwnedByFromModelId(modelId: string): ModelOwner | undefined {
	const lower = modelId.toLowerCase();
	if (lower.includes('claude') || lower.startsWith('anthropic/'))
		return 'anthropic';
	if (
		lower.includes('gpt') ||
		lower.startsWith('openai/') ||
		lower.includes('codex')
	)
		return 'openai';
	if (lower.includes('gemini') || lower.startsWith('google/')) return 'google';
	if (lower.includes('kimi') || lower.startsWith('moonshotai/')) return 'kimi';
	if (
		lower.includes('glm') ||
		lower.startsWith('z-ai/') ||
		lower.startsWith('thudm/')
	)
		return 'zai';
	if (lower.includes('deepseek') || lower.startsWith('deepseek/'))
		return 'deepseek';
	if (lower.includes('minimax')) return 'minimax';
	if (
		lower.includes('grok') ||
		lower.startsWith('x-ai/') ||
		lower.startsWith('xai/')
	)
		return 'xai';
	return undefined;
}

function createEmptyEntry(id: BuiltInProviderId): ProviderCatalogEntry {
	return { id, models: [] };
}

function normalizeString(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed.length) return trimmed;
	}
	return undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out = value
		.map((item) => normalizeString(item))
		.filter((item): item is string => Boolean(item));
	return out.length ? out : undefined;
}

function firstDefined<T>(...values: T[]): T | undefined {
	for (const value of values) {
		if (value !== undefined && value !== null) return value;
	}
	return undefined;
}

function pickProviders(
	feed: ProviderFeed,
): Partial<Record<BuiltInProviderId, ProviderCatalogEntry>> {
	const out: Partial<Record<BuiltInProviderId, ProviderCatalogEntry>> = {
		openai: createEmptyEntry('openai'),
		anthropic: createEmptyEntry('anthropic'),
		google: createEmptyEntry('google'),
		baseten: createEmptyEntry('baseten'),
		huggingface: createEmptyEntry('huggingface'),
		openrouter: createEmptyEntry('openrouter'),
		opencode: createEmptyEntry('opencode'),
		xai: createEmptyEntry('xai'),
		zai: createEmptyEntry('zai'),
		'zai-coding': createEmptyEntry('zai-coding'),
		deepseek: createEmptyEntry('deepseek'),
		kimi: createEmptyEntry('kimi'),
		minimax: createEmptyEntry('minimax'),
		copilot: createEmptyEntry('copilot'),
		'ollama-cloud': createEmptyEntry('ollama-cloud'),
	};
	for (const providerKey of Object.keys(feed)) {
		let targetKey: BuiltInProviderId | undefined;
		if (
			[
				'openai',
				'anthropic',
				'google',
				'baseten',
				'huggingface',
				'openrouter',
				'opencode',
				'xai',
				'zai',
				'deepseek',
				'minimax',
				'ollama-cloud',
			].includes(providerKey)
		) {
			targetKey = providerKey as BuiltInProviderId;
		}
		if (providerKey === 'zai-coding-plan') {
			targetKey = 'zai-coding';
		}
		if (providerKey === 'moonshotai') {
			targetKey = 'kimi';
		}
		if (providerKey === 'github-copilot') {
			targetKey = 'copilot';
		}
		if (providerKey === 'minimax') {
			targetKey = 'minimax';
		}
		if (!targetKey) continue;
		const entry = feed[providerKey];
		const key = targetKey;
		const isAggregate = [
			'baseten',
			'huggingface',
			'openrouter',
			'opencode',
			'copilot',
			'ollama-cloud',
		].includes(key);
		const staticOwner = SINGLE_PROVIDER_OWNER[providerKey];
		const models: ModelInfo[] = [];
		for (const mid of Object.keys(entry.models || {})) {
			const raw = entry.models[mid] as Record<string, unknown> | undefined;
			const family = normalizeString(raw?.family);
			let ownedBy: ModelOwner | undefined;
			if (isAggregate) {
				ownedBy =
					resolveOwnedByFromFamily(family) ?? resolveOwnedByFromModelId(mid);
			} else {
				ownedBy = staticOwner;
			}
			const model = mapModel(mid, raw, ownedBy);
			if (isSupportedCatalogModel(model)) models.push(model);
		}
		models.sort((a, b) => a.id.localeCompare(b.id));
		const base = createEmptyEntry(key);
		const label = normalizeString(entry.name);
		if (label) base.label = label;
		const env = normalizeStringArray(entry.env);
		if (env) base.env = env;
		const npm = normalizeString(entry.npm);
		if (npm) base.npm = npm;
		const api = normalizeString(entry.api);
		if (api) base.api = api;
		if (key === 'ollama-cloud') {
			base.npm = 'ai-sdk-ollama';
			base.api = 'https://ollama.com';
		}
		if (key === 'baseten') {
			base.label = 'Baseten';
			base.env = ['BASETEN_API_KEY'];
			base.npm = '@ai-sdk/baseten';
			base.api = 'https://inference.baseten.co/v1';
			base.doc = 'https://docs.baseten.co/development/model-apis/overview';
		}
		if (key === 'huggingface') {
			base.label = 'Hugging Face';
			base.env = ['HF_TOKEN', 'HUGGINGFACE_API_KEY'];
			base.npm = '@ai-sdk/huggingface';
			base.api = 'https://router.huggingface.co/v1';
			base.doc = 'https://huggingface.co/docs/inference-providers/index';
		}
		const doc = normalizeString(entry.doc);
		if (doc) base.doc = doc;
		base.models = models;
		out[key] = base;
	}
	applyOfficialKimiCatalogMetadata(out);
	return out;
}

function applyOfficialKimiCatalogMetadata(
	catalog: Partial<Record<BuiltInProviderId, ProviderCatalogEntry>>,
) {
	const entry = catalog.kimi;
	if (!entry) return;
	entry.label = 'Kimi';
	entry.env = Array.from(new Set(['KIMI_API_KEY', ...(entry.env ?? [])]));
	entry.doc = 'https://platform.kimi.ai/docs/api/overview.md';
}

function mapModel(
	id: string,
	raw?: Record<string, unknown>,
	ownedBy?: ModelOwner,
): ModelInfo {
	const m = raw ?? {};
	const info: ModelInfo = { id: String(m.id ?? id) };
	if (ownedBy) info.ownedBy = ownedBy;
	if (typeof m.name === 'string' && m.name.trim()) info.label = m.name;
	const modalities = normalizeModalities(m.modalities);
	if (modalities) info.modalities = modalities;
	if (hasValue(m.tool_call)) info.toolCall = Boolean(m.tool_call);
	if (hasValue(m.reasoning)) info.reasoningText = Boolean(m.reasoning);
	if (hasValue(m.attachment)) info.attachment = Boolean(m.attachment);
	const editToolCapability = normalizeEditToolCapability(
		m.edit_tool_capability ?? m.editToolCapability,
	);
	if (editToolCapability) info.editToolCapability = editToolCapability;
	const temperature = normalizeTemperature(m.temperature);
	if (temperature !== undefined) info.temperature = temperature;
	if (typeof m.knowledge === 'string' && m.knowledge.trim())
		info.knowledge = m.knowledge;
	if (typeof m.release_date === 'string' && m.release_date.trim())
		info.releaseDate = m.release_date;
	if (typeof m.last_updated === 'string' && m.last_updated.trim())
		info.lastUpdated = m.last_updated;
	if (hasValue(m.open_weights)) info.openWeights = Boolean(m.open_weights);
	const cost = normalizeCost(m.cost);
	if (cost) info.cost = cost;
	const limit = normalizeLimit(m.limit);
	if (limit) info.limit = limit;
	const provider = normalizeProviderBinding(m.provider);
	if (provider) info.provider = provider;
	return info;
}

function isSupportedCatalogModel(model: ModelInfo): boolean {
	if (model.toolCall !== true) return false;
	const inputModalities = model.modalities?.input ?? [];
	if (inputModalities.length > 0 && !inputModalities.includes('text')) {
		return false;
	}
	const outputModalities = model.modalities?.output ?? [];
	if (outputModalities.length > 0 && !outputModalities.includes('text')) {
		return false;
	}
	return true;
}

function normalizeModalities(value: unknown) {
	if (!value || typeof value !== 'object') return undefined;
	const obj = value as Record<string, unknown>;
	const input = Array.isArray(obj.input)
		? obj.input.filter((v) => typeof v === 'string')
		: undefined;
	const output = Array.isArray(obj.output)
		? obj.output.filter((v) => typeof v === 'string')
		: undefined;
	if (!input && !output) return undefined;
	return { input, output };
}

function normalizeTemperature(value: unknown): boolean | number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'boolean') return value;
	return undefined;
}

function normalizeEditToolCapability(value: unknown) {
	if (value === 'structured' || value === 'patch') return value;
	return undefined;
}

function normalizeCost(value: unknown) {
	if (!value || typeof value !== 'object') return undefined;
	const obj = value as Record<string, unknown>;
	const input = toNumber(obj.input);
	const output = toNumber(obj.output);
	const cacheRead = toNumber(obj.cache_read ?? obj.cacheRead);
	const cacheWrite = toNumber(obj.cache_write ?? obj.cacheWrite);
	if (
		input == null &&
		output == null &&
		cacheRead == null &&
		cacheWrite == null
	)
		return undefined;
	return {
		input: input ?? undefined,
		output: output ?? undefined,
		cacheRead: cacheRead ?? undefined,
		cacheWrite: cacheWrite ?? undefined,
	};
}

function normalizeLimit(value: unknown) {
	if (!value || typeof value !== 'object') return undefined;
	const obj = value as Record<string, unknown>;
	const context = toNumber(obj.context);
	const output = toNumber(obj.output);
	if (context == null && output == null) return undefined;
	return {
		context: context ?? undefined,
		output: output ?? undefined,
	};
}

function normalizeProviderBinding(
	value: unknown,
): ModelProviderBinding | undefined {
	if (value == null) return undefined;
	if (typeof value === 'string') {
		const npm = normalizeString(value);
		return npm ? { npm } : undefined;
	}
	if (typeof value !== 'object') return undefined;
	const record = value as Record<string, unknown>;
	const binding: ModelProviderBinding = {};
	const id = normalizeString(record.id);
	if (id) binding.id = id;
	const npm = normalizeString(record.npm);
	if (npm) binding.npm = npm;
	const api = normalizeString(firstDefined(record.api, record.url));
	if (api) binding.api = api;
	const baseURL = normalizeString(
		firstDefined(
			record.baseURL,
			record.base_url,
			record['base-url'],
			record.api,
		),
	);
	if (baseURL) binding.baseURL = baseURL;
	if (!binding.baseURL && binding.api) binding.baseURL = binding.api;
	return binding.id || binding.npm || binding.api || binding.baseURL
		? binding
		: undefined;
}

function hasValue(value: unknown) {
	return value !== undefined && value !== null;
}

function toNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed.length) return null;
		const parsed = Number(trimmed);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function toTs(
	catalog: Partial<Record<BuiltInProviderId, ProviderCatalogEntry>>,
) {
	const header = `// AUTO-GENERATED by scripts/update-catalog.ts. Do not edit manually.\n`;
	const imports = `import type { BuiltInProviderId, ProviderCatalogEntry } from '../../types/src/index.ts';\n`;
	const bodyObject = JSON.stringify(catalog, null, BIOME_JSON_INDENT);
	const type = 'Partial<Record<BuiltInProviderId, ProviderCatalogEntry>>';
	const body = `export const catalog: ${type} = ${bodyObject} as const satisfies ${type};\n`;
	return `${header}\n${imports}\n${body}`;
}

function normalizeOttoRouterOwner(owner: string): ModelOwner {
	return owner === 'moonshot' ? 'kimi' : (owner as ModelOwner);
}

function buildOttoRouterEntry(
	data: OttoRouterApiModel[],
): ProviderCatalogEntry {
	const models: ModelInfo[] = data
		.map((m) => {
			const ownedBy = normalizeOttoRouterOwner(m.owned_by);
			return {
				id: m.id,
				ownedBy,
				...(m.name ? { label: m.name } : {}),
				...(m.modalities ? { modalities: m.modalities } : {}),
				toolCall: m.tool_call ?? m.capabilities?.tool_call ?? false,
				reasoningText: m.reasoning ?? m.capabilities?.reasoning ?? false,
				...(m.attachment !== undefined ? { attachment: m.attachment } : {}),
				...(m.temperature !== undefined ? { temperature: m.temperature } : {}),
				...(m.knowledge ? { knowledge: m.knowledge } : {}),
				...(m.release_date ? { releaseDate: m.release_date } : {}),
				...(m.last_updated ? { lastUpdated: m.last_updated } : {}),
				...(m.open_weights !== undefined
					? { openWeights: m.open_weights }
					: {}),
				cost: {
					input: m.pricing.input,
					output: m.pricing.output,
					...(m.pricing.cache_read !== undefined
						? { cacheRead: m.pricing.cache_read }
						: {}),
					...(m.pricing.cache_write !== undefined
						? { cacheWrite: m.pricing.cache_write }
						: {}),
				},
				limit: {
					context: m.context_length,
					output: m.max_output,
				},
				...(OWNER_NPM[ownedBy]
					? { provider: { npm: OWNER_NPM[ownedBy] } }
					: {}),
			} satisfies ModelInfo;
		})
		.filter(isSupportedCatalogModel)
		.sort((a, b) => {
			const ownerA = a.ownedBy ?? '';
			const ownerB = b.ownedBy ?? '';
			if (ownerA === ownerB) return a.id.localeCompare(b.id);
			if (ownerA === 'openai') return -1;
			if (ownerB === 'openai') return 1;
			return ownerA.localeCompare(ownerB);
		});

	const defaultModelId = 'gpt-5-codex';
	const defaultIdx = models.findIndex((m) => m.id === defaultModelId);
	if (defaultIdx > 0) {
		const [picked] = models.splice(defaultIdx, 1);
		models.unshift(picked);
	}

	return {
		id: 'ottorouter',
		label: 'OttoRouter',
		env: ['OTTOROUTER_PRIVATE_KEY'],
		api: 'https://api.ottorouter.org/v1',
		doc: 'https://ottorouter.org/docs',
		models,
	};
}

async function writeRemoteCatalogJson(
	catalog: Partial<Record<BuiltInProviderId, ProviderCatalogEntry>>,
	ottorouterEntry?: ProviderCatalogEntry,
) {
	const providers: Partial<Record<BuiltInProviderId, ProviderCatalogEntry>> = {
		...catalog,
	};
	if (ottorouterEntry) providers.ottorouter = ottorouterEntry;

	const payload = {
		version: 1,
		updatedAt: new Date().toISOString(),
		providers,
	};

	await import('node:fs/promises').then((fs) =>
		fs.mkdir('apps/landing/public/catalog', { recursive: true }),
	);
	await Bun.write(
		REMOTE_CATALOG_TARGET,
		`${JSON.stringify(payload, null, BIOME_JSON_INDENT)}\n`,
	);
	console.log(`Wrote ${REMOTE_CATALOG_TARGET}`);
}

async function main() {
	const args = process.argv.slice(2);
	const ottorouterOnly = args.includes('--ottorouter');
	const skipOttoRouter = args.includes('--no-ottorouter');
	const fromIdx = args.indexOf('--from');
	let picked:
		| Partial<Record<BuiltInProviderId, ProviderCatalogEntry>>
		| undefined;
	let ottorouterEntry: ProviderCatalogEntry | undefined;

	if (!ottorouterOnly) {
		let feed: ProviderFeed;
		if (fromIdx >= 0) {
			const file = args[fromIdx + 1];
			if (!file) throw new Error('--from requires a filepath');
			console.log(`Reading ${file} ...`);
			const text = await Bun.file(file).text();
			feed = JSON.parse(text) as ProviderFeed;
		} else {
			console.log(`Fetching ${SOURCE} ...`);
			const res = await fetch(SOURCE);
			if (!res.ok)
				throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
			feed = (await res.json()) as ProviderFeed;
		}
		picked = pickProviders(feed);
		const ts = toTs(picked);
		await Bun.write(TARGET, ts);
		console.log(`Wrote ${TARGET}`);
	}

	if (!skipOttoRouter) {
		ottorouterEntry = await updateOttoRouterCatalog();
	}

	if (picked) {
		const merged = mergeManualCatalog(picked);
		await writeRemoteCatalogJson(merged, ottorouterEntry);
	}
}

interface OttoRouterApiModel {
	id: string;
	object: string;
	created: number;
	owned_by: string;
	name?: string;
	family?: string;
	attachment?: boolean;
	reasoning?: boolean;
	tool_call?: boolean;
	temperature?: boolean | number;
	knowledge?: string;
	release_date?: string;
	last_updated?: string;
	open_weights?: boolean;
	modalities?: { input?: string[]; output?: string[] };
	pricing: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
	};
	context_length: number;
	max_output: number;
	capabilities?: { tool_call?: boolean; reasoning?: boolean };
}

async function updateOttoRouterCatalog(): Promise<ProviderCatalogEntry> {
	console.log(`Fetching ${OTTOROUTER_SOURCE} ...`);
	const res = await fetch(OTTOROUTER_SOURCE);
	if (!res.ok)
		throw new Error(
			`Failed to fetch OttoRouter catalog: ${res.status} ${res.statusText}`,
		);
	const data = (await res.json()) as { data: OttoRouterApiModel[] };

	const providers = [
		...new Set(data.data.map((m) => normalizeOttoRouterOwner(m.owned_by))),
	].sort();

	const models = data.data
		.filter((m) =>
			isSupportedCatalogModel({
				id: m.id,
				toolCall: m.tool_call ?? m.capabilities?.tool_call ?? false,
				...(m.modalities ? { modalities: m.modalities } : {}),
			}),
		)
		.map((m) => ({
			id: m.id,
			...(m.name ? { name: m.name } : {}),
			owned_by: normalizeOttoRouterOwner(m.owned_by),
			context_length: m.context_length,
			max_output: m.max_output,
			reasoning: m.reasoning ?? m.capabilities?.reasoning ?? false,
			tool_call: m.tool_call ?? m.capabilities?.tool_call ?? false,
			...(m.attachment !== undefined ? { attachment: m.attachment } : {}),
			...(m.temperature !== undefined ? { temperature: m.temperature } : {}),
			...(m.knowledge ? { knowledge: m.knowledge } : {}),
			...(m.release_date ? { release_date: m.release_date } : {}),
			...(m.last_updated ? { last_updated: m.last_updated } : {}),
			...(m.open_weights !== undefined ? { open_weights: m.open_weights } : {}),
			...(m.modalities ? { modalities: m.modalities } : {}),
			pricing: {
				input: m.pricing.input,
				output: m.pricing.output,
				...(m.pricing.cache_read !== undefined
					? { cache_read: m.pricing.cache_read }
					: {}),
				...(m.pricing.cache_write !== undefined
					? { cache_write: m.pricing.cache_write }
					: {}),
			},
		}))
		.sort((a, b) => {
			const ownerCmp = a.owned_by.localeCompare(b.owned_by);
			return ownerCmp !== 0 ? ownerCmp : a.id.localeCompare(b.id);
		});

	const catalog = {
		models,
		providers,
		lastUpdated: new Date().toISOString().split('T')[0],
	};

	const catalogJson = JSON.stringify(catalog, null, BIOME_JSON_INDENT);
	const ts = `// AUTO-GENERATED by scripts/update-catalog.ts --ottorouter. Do not edit manually.\n\nexport interface OttoRouterModelCatalogEntry {\n\tid: string;\n\tname?: string;\n\towned_by: string;\n\tcontext_length: number;\n\tmax_output: number;\n\treasoning: boolean;\n\ttool_call: boolean;\n\tattachment?: boolean;\n\ttemperature?: boolean | number;\n\tknowledge?: string;\n\trelease_date?: string;\n\tlast_updated?: string;\n\topen_weights?: boolean;\n\tmodalities?: {\n\t\tinput?: string[];\n\t\toutput?: string[];\n\t};\n\tpricing: {\n\t\tinput: number;\n\t\toutput: number;\n\t\tcache_read?: number;\n\t\tcache_write?: number;\n\t};\n}\n\nexport interface OttoRouterCatalog {\n\tmodels: OttoRouterModelCatalogEntry[];\n\tproviders: string[];\n\tlastUpdated: string;\n}\n\nexport const ottorouterCatalog: OttoRouterCatalog = ${catalogJson} as const satisfies OttoRouterCatalog;\n`;

	await Bun.write(OTTOROUTER_TARGET, ts);
	console.log(
		`Wrote ${OTTOROUTER_TARGET} (${data.data.length} models, ${providers.length} providers)`,
	);

	return buildOttoRouterEntry(data.data);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
