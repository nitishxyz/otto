import { getGlobalConfigDir, joinPath } from '../../config/src/paths.ts';
import type { ModelInfo, ProviderId } from '../../types/src/index.ts';
import { appendXaiGrokCliModels } from './catalog-manual.ts';

export type CachedProviderCatalogEntry = {
	id: ProviderId;
	label?: string;
	models: ModelInfo[];
};

export type CachedModelCatalog = {
	version: 1;
	updatedAt: string;
	providers: Record<string, CachedProviderCatalogEntry>;
};

export const DEFAULT_REMOTE_MODEL_CATALOG_URL =
	'https://ottocode.io/catalog/models.json';

const MODEL_CATALOG_CACHE_FILENAME = 'catalog-models.json';

export function getModelCatalogCachePath(): string {
	return joinPath(getGlobalConfigDir(), MODEL_CATALOG_CACHE_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadFsPromises(): Promise<typeof import('node:fs/promises')> {
	return Function('specifier', 'return import(specifier)')('node:fs/promises');
}

function readFileSyncCompat(path: string): string | null {
	try {
		const fs = globalThis.process?.getBuiltinModule?.('node:fs') as
			| { readFileSync: (filePath: string, encoding: 'utf8') => string }
			| undefined;
		return fs?.readFileSync(path, 'utf8') ?? null;
	} catch {
		return null;
	}
}

function normalizeProviderEntry(
	id: string,
	value: unknown,
): CachedProviderCatalogEntry | null {
	if (!isRecord(value)) return null;
	const models = Array.isArray(value.models)
		? value.models.filter(
				(model): model is ModelInfo =>
					isRecord(model) && typeof model.id === 'string',
			)
		: [];
	return {
		id: (typeof value.id === 'string' ? value.id : id) as ProviderId,
		label: typeof value.label === 'string' ? value.label : undefined,
		models,
	};
}

export function normalizeModelCatalogPayload(
	payload: unknown,
): Record<string, CachedProviderCatalogEntry> {
	if (!isRecord(payload)) return {};
	const source = isRecord(payload.providers) ? payload.providers : payload;
	const providers: Record<string, CachedProviderCatalogEntry> = {};
	for (const [id, value] of Object.entries(source)) {
		const entry = normalizeProviderEntry(id, value);
		if (entry) providers[id] = entry;
	}
	const xaiEntry = appendXaiGrokCliModels(providers.xai);
	if (xaiEntry) {
		providers.xai = xaiEntry;
	}
	return providers;
}

function normalizeCachedModelCatalogPayload(
	payload: unknown,
): CachedModelCatalog {
	const updatedAt =
		isRecord(payload) && typeof payload.updatedAt === 'string'
			? payload.updatedAt
			: new Date(0).toISOString();
	return {
		version: 1,
		updatedAt,
		providers: normalizeModelCatalogPayload(payload),
	};
}

export async function readCachedModelCatalog(): Promise<CachedModelCatalog | null> {
	try {
		const { readFile } = await loadFsPromises();
		const payload = JSON.parse(
			await readFile(getModelCatalogCachePath(), 'utf8'),
		);
		return normalizeCachedModelCatalogPayload(payload);
	} catch {
		return null;
	}
}

export function readCachedModelCatalogSync(): CachedModelCatalog | null {
	try {
		const text = readFileSyncCompat(getModelCatalogCachePath());
		if (!text) return null;
		const payload = JSON.parse(text);
		return normalizeCachedModelCatalogPayload(payload);
	} catch {
		return null;
	}
}

export function getCachedProviderCatalogEntry(
	provider: ProviderId,
): CachedProviderCatalogEntry | undefined {
	return readCachedModelCatalogSync()?.providers[provider];
}

export async function writeCachedModelCatalog(
	providers: Record<string, CachedProviderCatalogEntry>,
): Promise<void> {
	const path = getModelCatalogCachePath();
	const dir = path.slice(0, path.lastIndexOf('/'));
	const { mkdir, writeFile } = await loadFsPromises();
	await mkdir(dir, { recursive: true });
	await writeFile(
		path,
		JSON.stringify(
			{
				version: 1,
				updatedAt: new Date().toISOString(),
				providers,
			},
			null,
			2,
		),
	);
}

export async function mergeCachedModelCatalog(
	providers: Record<string, CachedProviderCatalogEntry>,
): Promise<void> {
	const existing = await readCachedModelCatalog();
	await writeCachedModelCatalog({
		...(existing?.providers ?? {}),
		...providers,
	});
}
