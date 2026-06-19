import { createHash } from 'node:crypto';
import type { OAuth, ProviderId } from '@ottocode/sdk';
import {
	fetchAnthropicUsage,
	fetchKimiUsage,
	fetchOpenAIUsage,
	fetchXaiGrokUsage,
	type ProviderUsage,
} from './fetchers.ts';

const USAGE_CACHE_TTL_MS = 60_000;

type UsageCacheEntry = {
	data?: ProviderUsage;
	fetchedAt?: number;
	inflight?: Promise<ProviderUsage>;
};

const usageCache = new Map<string, UsageCacheEntry>();

function usageCacheIdentity(oauth: OAuth) {
	return (
		oauth.accountId ?? createHash('sha256').update(oauth.refresh).digest('hex')
	);
}

function usageCacheKey(provider: ProviderId, oauth: OAuth) {
	return [provider, usageCacheIdentity(oauth)].join(':');
}

export async function fetchProviderUsage(
	provider: ProviderId,
	tokenResult: { access: string; oauth: OAuth },
) {
	const cacheKey = usageCacheKey(provider, tokenResult.oauth);
	const now = Date.now();
	const cached = usageCache.get(cacheKey);

	if (
		cached?.data &&
		cached.fetchedAt &&
		now - cached.fetchedAt < USAGE_CACHE_TTL_MS
	) {
		return cached.data;
	}

	if (cached?.inflight) return cached.inflight;

	const inflight =
		provider === 'anthropic'
			? fetchAnthropicUsage(tokenResult.access)
			: provider === 'xai'
				? fetchXaiGrokUsage(tokenResult.access)
				: provider === 'kimi'
					? fetchKimiUsage(tokenResult.access)
					: fetchOpenAIUsage(tokenResult.access, tokenResult.oauth.accountId);

	usageCache.set(cacheKey, {
		data: cached?.data,
		fetchedAt: cached?.fetchedAt,
		inflight,
	});

	try {
		const data = await inflight;
		usageCache.set(cacheKey, { data, fetchedAt: Date.now() });
		return data;
	} catch (error) {
		if (cached?.data && cached.fetchedAt) {
			usageCache.set(cacheKey, {
				data: cached.data,
				fetchedAt: cached.fetchedAt,
			});
		} else {
			usageCache.delete(cacheKey);
		}
		throw error;
	}
}
