import { getRuntimeProjectContext } from './config';
import { getOwnerSessionHeaders } from './owner-auth';
import { getShareAuthHeaders, isShareMode } from './share-mode';

interface CachedAsset {
	objectUrl: string;
	consumers: number;
}

const assetCache = new Map<string, CachedAsset>();
const pendingAssets = new Map<string, Promise<string>>();
let authGeneration = 0;

function isInlineAsset(url: string): boolean {
	return url.startsWith('data:') || url.startsWith('blob:');
}

function assetAuthHeaders(): Record<string, string> {
	if (isShareMode()) return getShareAuthHeaders();
	const context = getRuntimeProjectContext();
	return {
		...(context?.serverToken
			? {
					Authorization: `Bearer ${context.serverToken}`,
					'X-Otto-Server-Token': context.serverToken,
				}
			: {}),
		...getOwnerSessionHeaders(),
		...(context?.projectId ? { 'X-Otto-Project-Id': context.projectId } : {}),
		...(context?.projectRoot ? { 'X-Otto-Project': context.projectRoot } : {}),
	};
}

function cacheKey(url: string): string {
	return `${authGeneration}:${url}`;
}

/** Invalidates future authenticated asset lookups without retaining tokens. */
export function invalidateAuthenticatedAssets(): void {
	authGeneration += 1;
}

/** Fetches an asset with current daemon auth and returns a releasable URL. */
export async function acquireAuthenticatedAsset(
	url: string,
	fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ url: string; release: () => void }> {
	if (isInlineAsset(url)) return { url, release: () => {} };
	const key = cacheKey(url);
	let cached = assetCache.get(key);
	if (!cached) {
		let pending = pendingAssets.get(key);
		if (!pending) {
			pending = fetcher(url, {
				headers: assetAuthHeaders(),
				credentials: 'include',
				cache: 'no-store',
			}).then(async (response) => {
				if (!response.ok) {
					throw new Error(
						`Attachment request failed (HTTP ${response.status})`,
					);
				}
				return URL.createObjectURL(await response.blob());
			});
			pendingAssets.set(key, pending);
		}
		try {
			const objectUrl = await pending;
			cached = assetCache.get(key) ?? { objectUrl, consumers: 0 };
			assetCache.set(key, cached);
		} finally {
			pendingAssets.delete(key);
		}
	}
	cached.consumers += 1;
	let released = false;
	return {
		url: cached.objectUrl,
		release: () => {
			if (released) return;
			released = true;
			const current = assetCache.get(key);
			if (!current) return;
			current.consumers -= 1;
			if (current.consumers <= 0) {
				assetCache.delete(key);
				URL.revokeObjectURL(current.objectUrl);
			}
		},
	};
}
