import {
	readFileSync,
	writeFileSync,
	existsSync,
	readdirSync,
	mkdirSync,
	renameSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ModelApi } from './types.ts';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const OPENCLAW_CONFIG_PATH = join(OPENCLAW_DIR, 'openclaw.json');

const PROVIDER_KEY = 'ottorouter';
const DEFAULT_PROXY_PORT = 8403;
const DEFAULT_BASE_URL = 'https://api.ottorouter.org';
const OTTOROUTER_PROXY_PORT_PATTERN = /[:/]8403/;

export interface OttoRouterModelConfig {
	id: string;
	name: string;
	api?: ModelApi;
	reasoning?: boolean;
	input?: Array<'text' | 'image'>;
	contextWindow?: number;
	maxTokens?: number;
}

export interface OttoRouterProviderConfig {
	baseUrl: string;
	apiKey: string;
	api: ModelApi;
	authHeader: boolean;
	models: OttoRouterModelConfig[];
}

const DUMMY_API_KEY = 'ottorouter-proxy-handles-auth';

const MODEL_ALIASES: Array<{ id: string; alias: string }> = [
	{ id: 'claude-sonnet-4-6', alias: 'sonnet-4.6' },
	{ id: 'claude-sonnet-4-5', alias: 'sonnet-4.5' },
	{ id: 'claude-opus-4-7', alias: 'opus' },
	{ id: 'claude-3-5-haiku-20241022', alias: 'haiku' },
	{ id: 'gpt-5.1-codex', alias: 'codex' },
	{ id: 'gpt-5', alias: 'gpt5' },
	{ id: 'gpt-5-mini', alias: 'gpt5-mini' },
	{ id: 'codex-mini-latest', alias: 'codex-mini' },
	{ id: 'gemini-3-pro-preview', alias: 'gemini-pro' },
	{ id: 'gemini-3-flash-preview', alias: 'gemini-flash' },
	{ id: 'kimi-k2.5', alias: 'kimi' },
	{ id: 'glm-5', alias: 'glm' },
	{ id: 'MiniMax-M2.5', alias: 'minimax' },
];

function readOpenClawConfig(): Record<string, unknown> {
	if (!existsSync(OPENCLAW_CONFIG_PATH)) return {};
	try {
		const content = readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8').trim();
		if (!content) return {};
		return JSON.parse(content);
	} catch {
		return {};
	}
}

function writeOpenClawConfigAtomic(config: Record<string, unknown>): void {
	if (!existsSync(OPENCLAW_DIR)) {
		mkdirSync(OPENCLAW_DIR, { recursive: true });
	}
	const tmpPath = `${OPENCLAW_CONFIG_PATH}.tmp.${process.pid}`;
	writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`);
	renameSync(tmpPath, OPENCLAW_CONFIG_PATH);
}

interface CatalogModel {
	id: string;
	owned_by: string;
	context_length: number;
	max_output: number;
	capabilities?: { tool_call?: boolean; reasoning?: boolean };
}

function displayName(id: string, owner: string): string {
	return `${id} (${owner}, via OttoRouter)`;
}

function apiForOwner(owner: string): ModelApi {
	switch (owner) {
		case 'anthropic':
			return 'anthropic-messages';
		case 'minimax':
			return 'anthropic-messages';
		case 'openai':
			return 'openai-responses';
		default:
			return 'openai-completions';
	}
}

export async function fetchModelsFromCatalog(
	baseURL: string = DEFAULT_BASE_URL,
): Promise<OttoRouterModelConfig[]> {
	try {
		const resp = await fetch(`${baseURL}/v1/models`);
		if (!resp.ok) return getDefaultModels();
		const data = (await resp.json()) as { data: CatalogModel[] };
		return data.data.map((m) => ({
			id: m.id,
			name: displayName(m.id, m.owned_by),
			api: apiForOwner(m.owned_by),
			reasoning: false,
			input: ['text'] as Array<'text' | 'image'>,
			contextWindow: m.context_length,
			maxTokens: m.max_output,
		}));
	} catch {
		return getDefaultModels();
	}
}

export function getDefaultModels(): OttoRouterModelConfig[] {
	return [
		{
			id: 'claude-sonnet-4-6',
			name: 'Claude Sonnet 4.6 (anthropic, via OttoRouter)',
			api: 'anthropic-messages',
			reasoning: false,
			input: ['text', 'image'],
			contextWindow: 200000,
			maxTokens: 64000,
		},
		{
			id: 'claude-sonnet-4-5',
			name: 'Claude Sonnet 4.5 (anthropic, via OttoRouter)',
			api: 'anthropic-messages',
			reasoning: false,
			input: ['text', 'image'],
			contextWindow: 200000,
			maxTokens: 64000,
		},
		{
			id: 'claude-opus-4-7',
			name: 'Claude Opus 4.7 (anthropic, via OttoRouter)',
			api: 'anthropic-messages',
			reasoning: true,
			input: ['text', 'image'],
			contextWindow: 1000000,
			maxTokens: 128000,
		},
		{
			id: 'claude-opus-4-6',
			name: 'Claude Opus 4.6 (anthropic, via OttoRouter)',
			api: 'anthropic-messages',
			reasoning: false,
			input: ['text', 'image'],
			contextWindow: 200000,
			maxTokens: 128000,
		},
		{
			id: 'claude-3-5-haiku-20241022',
			name: 'Claude 3.5 Haiku (anthropic, via OttoRouter)',
			api: 'anthropic-messages',
			reasoning: false,
			input: ['text', 'image'],
			contextWindow: 200000,
			maxTokens: 8192,
		},
		{
			id: 'gpt-5.1-codex',
			name: 'GPT-5.1 Codex (openai, via OttoRouter)',
			api: 'openai-responses',
			reasoning: false,
			input: ['text', 'image'],
			contextWindow: 400000,
			maxTokens: 128000,
		},
		{
			id: 'gpt-5',
			name: 'GPT-5 (openai, via OttoRouter)',
			api: 'openai-responses',
			reasoning: false,
			input: ['text', 'image'],
			contextWindow: 400000,
			maxTokens: 128000,
		},
		{
			id: 'gpt-5-mini',
			name: 'GPT-5 Mini (openai, via OttoRouter)',
			api: 'openai-responses',
			reasoning: false,
			input: ['text', 'image'],
			contextWindow: 400000,
			maxTokens: 128000,
		},
		{
			id: 'codex-mini-latest',
			name: 'Codex Mini (openai, via OttoRouter)',
			api: 'openai-responses',
			reasoning: false,
			input: ['text'],
			contextWindow: 200000,
			maxTokens: 100000,
		},
		{
			id: 'gemini-3-pro-preview',
			name: 'Gemini 3 Pro (google, via OttoRouter)',
			api: 'openai-completions',
			reasoning: false,
			input: ['text', 'image'],
			contextWindow: 1000000,
			maxTokens: 64000,
		},
		{
			id: 'gemini-3-flash-preview',
			name: 'Gemini 3 Flash (google, via OttoRouter)',
			api: 'openai-completions',
			reasoning: false,
			input: ['text', 'image'],
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		{
			id: 'kimi-k2.5',
			name: 'Kimi K2.5 (via OttoRouter)',
			api: 'openai-completions',
			reasoning: false,
			input: ['text'],
			contextWindow: 262144,
			maxTokens: 262144,
		},
		{
			id: 'glm-5',
			name: 'GLM-5 (zai, via OttoRouter)',
			api: 'openai-completions',
			reasoning: false,
			input: ['text'],
			contextWindow: 204800,
			maxTokens: 131072,
		},
		{
			id: 'MiniMax-M2.5',
			name: 'MiniMax M2.5 (minimax, via OttoRouter)',
			api: 'anthropic-messages',
			reasoning: false,
			input: ['text'],
			contextWindow: 204800,
			maxTokens: 131072,
		},
	];
}

export function buildProviderConfig(
	port: number = DEFAULT_PROXY_PORT,
): OttoRouterProviderConfig {
	return {
		baseUrl: `http://localhost:${port}/v1`,
		apiKey: 'ottorouter-proxy-handles-auth',
		api: 'openai-completions',
		authHeader: false,
		models: getDefaultModels(),
	};
}

export async function buildProviderConfigWithCatalog(
	port: number = DEFAULT_PROXY_PORT,
	baseURL: string = DEFAULT_BASE_URL,
): Promise<OttoRouterProviderConfig> {
	const models = await fetchModelsFromCatalog(baseURL);
	return {
		baseUrl: `http://localhost:${port}/v1`,
		apiKey: 'ottorouter-proxy-handles-auth',
		api: 'openai-completions',
		authHeader: false,
		models,
	};
}

function removeConflictingCustomProviders(
	providers: Record<string, unknown>,
	port: number,
): string[] {
	const removed: string[] = [];
	for (const key of Object.keys(providers)) {
		if (key === PROVIDER_KEY) continue;
		if (!key.startsWith('custom-')) continue;
		const p = providers[key] as Record<string, unknown> | undefined;
		if (!p?.baseUrl) continue;
		const baseUrl = String(p.baseUrl);
		const pointsToOttoRouterProxy =
			baseUrl.includes(`:${port}`) ||
			OTTOROUTER_PROXY_PORT_PATTERN.test(baseUrl);
		if (pointsToOttoRouterProxy) {
			delete providers[key];
			removed.push(key);
		}
	}
	return removed;
}

function migrateDefaultModel(
	config: Record<string, unknown>,
	removedKeys: string[],
): void {
	if (removedKeys.length === 0) return;
	const agents = config.agents as Record<string, unknown> | undefined;
	const defaults = agents?.defaults as Record<string, unknown> | undefined;
	const model = defaults?.model as Record<string, unknown> | undefined;
	if (!model?.primary) return;
	const primary = String(model.primary);
	for (const oldKey of removedKeys) {
		if (primary.startsWith(`${oldKey}/`)) {
			const modelId = primary.slice(oldKey.length + 1);
			model.primary = `ottorouter/${modelId}`;
			break;
		}
	}
}

export function injectConfig(port: number = DEFAULT_PROXY_PORT): void {
	const config = readOpenClawConfig();
	let needsWrite = false;

	if (!config.models) {
		config.models = {};
		needsWrite = true;
	}
	const models = config.models as Record<string, unknown>;
	if (!models.providers) {
		models.providers = {};
		needsWrite = true;
	}
	const providers = models.providers as Record<string, unknown>;

	const removed = removeConflictingCustomProviders(providers, port);
	if (removed.length > 0) {
		migrateDefaultModel(config, removed);
		needsWrite = true;
	}

	const expectedBaseUrl = `http://localhost:${port}/v1`;
	const existing = providers[PROVIDER_KEY] as
		| Record<string, unknown>
		| undefined;

	if (!existing) {
		providers[PROVIDER_KEY] = buildProviderConfig(port);
		needsWrite = true;
	} else {
		if (!existing.baseUrl || existing.baseUrl !== expectedBaseUrl) {
			existing.baseUrl = expectedBaseUrl;
			needsWrite = true;
		}
		if (!existing.apiKey) {
			existing.apiKey = DUMMY_API_KEY;
			needsWrite = true;
		}
		if (!existing.api) {
			existing.api = 'openai-completions';
			needsWrite = true;
		}
		const currentModels = existing.models as Array<{ id?: string }> | undefined;
		const defaultModels = getDefaultModels();
		const currentIds = new Set(
			Array.isArray(currentModels)
				? currentModels.map((m) => m?.id).filter(Boolean)
				: [],
		);
		const expectedIds = defaultModels.map((m) => m.id);
		if (
			!currentModels ||
			!Array.isArray(currentModels) ||
			currentModels.length !== defaultModels.length ||
			expectedIds.some((id) => !currentIds.has(id))
		) {
			existing.models = getDefaultModels();
			needsWrite = true;
		}
	}

	if (!config.agents) {
		config.agents = {};
		needsWrite = true;
	}
	const agents = config.agents as Record<string, unknown>;
	if (!agents.defaults) {
		agents.defaults = {};
		needsWrite = true;
	}
	const defaults = agents.defaults as Record<string, unknown>;
	if (!defaults.model) {
		defaults.model = {};
		needsWrite = true;
	}
	const model = defaults.model as Record<string, unknown>;

	if (!model.primary) {
		model.primary = 'ottorouter/claude-sonnet-4-6';
		needsWrite = true;
	}

	if (!defaults.models) {
		defaults.models = {};
		needsWrite = true;
	}
	const allowlist = defaults.models as Record<string, unknown>;
	for (const m of MODEL_ALIASES) {
		const fullId = `ottorouter/${m.id}`;
		const entry = allowlist[fullId] as Record<string, unknown> | undefined;
		if (!entry) {
			allowlist[fullId] = { alias: m.alias };
			needsWrite = true;
		} else if (entry.alias !== m.alias) {
			entry.alias = m.alias;
			needsWrite = true;
		}
	}

	if (needsWrite) {
		writeOpenClawConfigAtomic(config);
	}
}

export function injectAuthProfile(): void {
	const agentsDir = join(OPENCLAW_DIR, 'agents');

	if (!existsSync(agentsDir)) {
		try {
			mkdirSync(agentsDir, { recursive: true });
		} catch {
			return;
		}
	}

	let agents: string[];
	try {
		agents = readdirSync(agentsDir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);
	} catch {
		agents = [];
	}

	if (!agents.includes('main')) {
		agents = ['main', ...agents];
	}

	for (const agentId of agents) {
		const authDir = join(agentsDir, agentId, 'agent');
		const authPath = join(authDir, 'auth-profiles.json');

		if (!existsSync(authDir)) {
			try {
				mkdirSync(authDir, { recursive: true });
			} catch {
				continue;
			}
		}

		let store: { version: number; profiles: Record<string, unknown> } = {
			version: 1,
			profiles: {},
		};
		if (existsSync(authPath)) {
			try {
				const existing = JSON.parse(readFileSync(authPath, 'utf-8'));
				if (existing.version && existing.profiles) {
					store = existing;
				}
			} catch {
				// use fresh store
			}
		}

		const profileKey = 'ottorouter:default';
		if (store.profiles[profileKey]) continue;

		store.profiles[profileKey] = {
			type: 'api_key',
			provider: 'ottorouter',
			key: DUMMY_API_KEY,
		};

		try {
			writeFileSync(authPath, JSON.stringify(store, null, 2));
		} catch {
			// skip
		}
	}
}

export function removeConfig(): void {
	const config = readOpenClawConfig();

	const models = config.models as Record<string, unknown> | undefined;
	if (!models?.providers) return;
	const providers = models.providers as Record<string, unknown>;
	delete providers[PROVIDER_KEY];

	writeOpenClawConfigAtomic(config);
}

export function isConfigured(): boolean {
	const config = readOpenClawConfig();
	const models = config.models as Record<string, unknown> | undefined;
	if (!models?.providers) return false;
	const providers = models.providers as Record<string, unknown>;
	return PROVIDER_KEY in providers;
}

export function getConfigPath(): string {
	return OPENCLAW_CONFIG_PATH;
}
