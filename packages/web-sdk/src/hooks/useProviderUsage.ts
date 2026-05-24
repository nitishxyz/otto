import { useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../lib/api-client';
import { useUsageStore } from '../stores/usageStore';

const POLL_INTERVAL = 60_000;
const STALE_THRESHOLD = 60_000;

const inflight = new Set<string>();

export function useProviderUsage(
	provider: string | undefined,
	authType: string | undefined,
) {
	const setUsage = useUsageStore((s) => s.setUsage);
	const setLoading = useUsageStore((s) => s.setLoading);
	const setLastFetched = useUsageStore((s) => s.setLastFetched);
	const isModalOpen = useUsageStore((s) => s.isModalOpen);
	const modalProvider = useUsageStore((s) => s.modalProvider);
	const usage = useUsageStore((s) =>
		provider ? s.usage[provider] : undefined,
	);

	const isOAuthProvider =
		authType === 'oauth' && (provider === 'anthropic' || provider === 'openai');

	const fetchUsage = useCallback(
		async (force = false) => {
			if (!provider || !isOAuthProvider) return;
			if (inflight.has(provider)) return;

			const last = useUsageStore.getState().lastFetched[provider] ?? 0;
			if (!force && last && Date.now() - last < STALE_THRESHOLD) return;

			inflight.add(provider);
			setLoading(provider, true);
			try {
				const data = await apiClient.getProviderUsage(provider);
				setUsage(provider, data);
				setLastFetched(provider, Date.now());
			} catch {
			} finally {
				setLoading(provider, false);
				inflight.delete(provider);
			}
		},
		[provider, isOAuthProvider, setUsage, setLoading, setLastFetched],
	);

	const fetchRef = useRef(fetchUsage);
	fetchRef.current = fetchUsage;

	useEffect(() => {
		if (!provider || !isOAuthProvider) return;

		fetchRef.current();
	}, [isOAuthProvider, provider]);

	useEffect(() => {
		if (
			!provider ||
			!isOAuthProvider ||
			!isModalOpen ||
			modalProvider !== provider
		) {
			return;
		}

		fetchRef.current(true);

		const interval = setInterval(() => fetchRef.current(), POLL_INTERVAL);
		return () => clearInterval(interval);
	}, [isModalOpen, isOAuthProvider, modalProvider, provider]);

	return {
		usage,
		fetchUsage,
		isOAuthProvider,
	};
}
