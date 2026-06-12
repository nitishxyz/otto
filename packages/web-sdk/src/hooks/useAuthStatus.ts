import { useEffect, useCallback, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { openPlatformUrl } from '../lib/platform';
import { useOnboardingStore } from '../stores/onboardingStore';

const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

export function useAuthStatus() {
	const setAuthStatus = useOnboardingStore((s) => s.setAuthStatus);
	const setOpen = useOnboardingStore((s) => s.setOpen);
	const setLoading = useOnboardingStore((s) => s.setLoading);
	const setError = useOnboardingStore((s) => s.setError);
	const authStatus = useOnboardingStore((s) => s.authStatus);
	const isOpen = useOnboardingStore((s) => s.isOpen);
	const queryClient = useQueryClient();

	const [initialized, setInitialized] = useState(false);
	const [oauthPolling, setOauthPolling] = useState(false);
	const oauthPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const preOauthProvidersRef = useRef<Set<string>>(new Set());

	const fetchAuthStatus = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const status = await apiClient.getAuthStatus();
			setAuthStatus(status);
			queryClient.invalidateQueries({ queryKey: ['config'] });
			queryClient.invalidateQueries({ queryKey: ['models'] });
			return status;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to load';
			setError(message);
			return null;
		} finally {
			setLoading(false);
		}
	}, [setAuthStatus, setLoading, setError, queryClient]);

	const checkOnboarding = useCallback(async () => {
		const status = await fetchAuthStatus();
		if (status) {
			const hasAnyProvider = Object.values(status.providers).some(
				(p) => p.configured,
			);
			const needsOnboarding =
				!status.onboardingComplete ||
				!hasAnyProvider ||
				!status.ottorouter.configured;
			if (needsOnboarding) {
				setOpen(true);
			}
		}
		setInitialized(true);
	}, [fetchAuthStatus, setOpen]);

	const setupWallet = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await apiClient.setupOttoRouterWallet();
			await fetchAuthStatus();
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Setup failed';
			setError(message);
			throw err;
		} finally {
			setLoading(false);
		}
	}, [fetchAuthStatus, setLoading, setError]);

	const importWallet = useCallback(
		async (privateKey: string) => {
			setLoading(true);
			setError(null);
			try {
				const result = await apiClient.importOttoRouterWallet(privateKey);
				await fetchAuthStatus();
				return result;
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Import failed';
				setError(message);
				throw err;
			} finally {
				setLoading(false);
			}
		},
		[fetchAuthStatus, setLoading, setError],
	);

	const addProvider = useCallback(
		async (provider: string, apiKey: string) => {
			setLoading(true);
			setError(null);
			try {
				const result = await apiClient.addProvider(provider, apiKey);
				await fetchAuthStatus();
				return result;
			} catch (err) {
				const message =
					err instanceof Error ? err.message : 'Failed to add provider';
				setError(message);
				throw err;
			} finally {
				setLoading(false);
			}
		},
		[fetchAuthStatus, setLoading, setError],
	);

	const addCustomProvider = useCallback(
		async (data: {
			id: string;
			label: string;
			baseURL: string;
			apiKey?: string;
			compatibility:
				| 'openai-compatible'
				| 'openai'
				| 'anthropic'
				| 'google'
				| 'openrouter'
				| 'ollama';
			models: string[];
			allowAnyModel: boolean;
		}) => {
			setLoading(true);
			setError(null);
			try {
				const result = await apiClient.updateProviderSettings(data.id, {
					enabled: true,
					custom: true,
					label: data.label,
					baseURL: data.baseURL,
					...(data.apiKey ? { apiKey: data.apiKey } : {}),
					compatibility: data.compatibility,
					models: data.models,
					allowAnyModel: data.allowAnyModel,
				});
				await fetchAuthStatus();
				return result;
			} catch (err) {
				const message =
					err instanceof Error ? err.message : 'Failed to add custom provider';
				setError(message);
				throw err;
			} finally {
				setLoading(false);
			}
		},
		[fetchAuthStatus, setLoading, setError],
	);

	const removeProvider = useCallback(
		async (provider: string) => {
			setLoading(true);
			setError(null);
			try {
				const isCustomProvider =
					useOnboardingStore.getState().authStatus?.providers[provider]?.custom;
				const result = isCustomProvider
					? await apiClient.deleteProviderSettings(provider)
					: await apiClient.removeProvider(provider);
				await fetchAuthStatus();
				return result;
			} catch (err) {
				const message =
					err instanceof Error ? err.message : 'Failed to remove provider';
				setError(message);
				throw err;
			} finally {
				setLoading(false);
			}
		},
		[fetchAuthStatus, setLoading, setError],
	);

	const completeOnboarding = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			await apiClient.completeOnboarding();
			await fetchAuthStatus();
			setOpen(false);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : 'Failed to complete onboarding';
			setError(message);
			throw err;
		} finally {
			setLoading(false);
		}
	}, [fetchAuthStatus, setLoading, setError, setOpen]);

	const snapshotConfiguredProviders = useCallback(() => {
		const status = useOnboardingStore.getState().authStatus;
		if (status) {
			preOauthProvidersRef.current = new Set(
				Object.entries(status.providers)
					.filter(([, p]) => p.configured)
					.map(([id]) => id),
			);
		}
	}, []);

	const startOAuth = useCallback(
		(provider: string, mode?: string) => {
			const url = apiClient.getOAuthStartUrl(provider, mode);
			if (openPlatformUrl(url)) {
				snapshotConfiguredProviders();
				setOauthPolling(true);
				return null;
			}
			if (isInIframe) {
				snapshotConfiguredProviders();
				window.parent.postMessage({ type: 'otto-open-url', url }, '*');
				setOauthPolling(true);
				return null;
			}
			const width = 600;
			const height = 700;
			const left = window.screenX + (window.outerWidth - width) / 2;
			const top = window.screenY + (window.outerHeight - height) / 2;
			const popup = window.open(
				url,
				'oauth_popup',
				`width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`,
			);
			return popup;
		},
		[snapshotConfiguredProviders],
	);

	const startOAuthManual = useCallback(
		async (provider: string, mode?: string) => {
			const { url, sessionId } = await apiClient.getOAuthUrl(provider, mode);

			if (openPlatformUrl(url)) {
				snapshotConfiguredProviders();
				setOauthPolling(true);
				return { popup: null, sessionId };
			}

			if (isInIframe) {
				snapshotConfiguredProviders();
				window.parent.postMessage({ type: 'otto-open-url', url }, '*');
				setOauthPolling(true);
				return { popup: null, sessionId };
			}

			const width = 600;
			const height = 700;
			const left = window.screenX + (window.outerWidth - width) / 2;
			const top = window.screenY + (window.outerHeight - height) / 2;
			const popup = window.open(
				url,
				'oauth_popup',
				`width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`,
			);
			return { popup, sessionId };
		},
		[snapshotConfiguredProviders],
	);

	const exchangeOAuthCode = useCallback(
		async (provider: string, code: string, sessionId: string) => {
			setLoading(true);
			setError(null);
			try {
				await apiClient.exchangeOAuthCode(provider, code, sessionId);
				await fetchAuthStatus();
				return true;
			} catch (err) {
				const message =
					err instanceof Error ? err.message : 'Failed to exchange code';
				setError(message);
				throw err;
			} finally {
				setLoading(false);
			}
		},
		[fetchAuthStatus, setLoading, setError],
	);

	useEffect(() => {
		if (!oauthPolling || !isInIframe) return;
		oauthPollingRef.current = setInterval(() => {
			fetchAuthStatus();
		}, 3000);
		const timeout = setTimeout(() => {
			setOauthPolling(false);
		}, 300000);
		return () => {
			clearInterval(oauthPollingRef.current);
			clearTimeout(timeout);
		};
	}, [oauthPolling, fetchAuthStatus]);

	useEffect(() => {
		if (!oauthPolling || !authStatus) return;
		const currentConfigured = Object.entries(authStatus.providers).filter(
			([, p]) => p.configured,
		);
		const hasNewProvider = currentConfigured.some(
			([id]) => !preOauthProvidersRef.current.has(id),
		);
		if (hasNewProvider) {
			setOauthPolling(false);
		}
	}, [authStatus, oauthPolling]);

	useEffect(() => {
		const handleOAuthMessage = (event: MessageEvent) => {
			if (event.data?.type === 'oauth-success') {
				fetchAuthStatus();
			}
		};

		window.addEventListener('message', handleOAuthMessage);
		return () => window.removeEventListener('message', handleOAuthMessage);
	}, [fetchAuthStatus]);

	const pollCopilotDeviceFlow = useCallback(
		async (sessionId: string) => {
			const result = await apiClient.pollCopilotDeviceFlow(sessionId);
			if (result.status === 'complete') {
				await fetchAuthStatus();
			}
			return result;
		},
		[fetchAuthStatus],
	);

	const pollOpenAIDeviceFlow = useCallback(
		async (sessionId: string) => {
			const result = await apiClient.pollOpenAIDeviceFlow(sessionId);
			if (result.status === 'complete') {
				await fetchAuthStatus();
			}
			return result;
		},
		[fetchAuthStatus],
	);

	const pollKimiDeviceFlow = useCallback(
		async (sessionId: string) => {
			const result = await apiClient.pollKimiDeviceFlow(sessionId);
			if (result.status === 'complete') {
				await fetchAuthStatus();
			}
			return result;
		},
		[fetchAuthStatus],
	);

	const saveCopilotToken = useCallback(
		async (token: string) => {
			setLoading(true);
			setError(null);
			try {
				const result = await apiClient.saveCopilotToken(token);
				await fetchAuthStatus();
				return result;
			} catch (err) {
				const message =
					err instanceof Error ? err.message : 'Failed to save Copilot token';
				setError(message);
				throw err;
			} finally {
				setLoading(false);
			}
		},
		[fetchAuthStatus, setLoading, setError],
	);

	const importCopilotTokenFromGh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await apiClient.importCopilotTokenFromGh();
			await fetchAuthStatus();
			return result;
		} catch (err) {
			const message =
				err instanceof Error
					? err.message
					: 'Failed to import Copilot token from GH';
			setError(message);
			throw err;
		} finally {
			setLoading(false);
		}
	}, [fetchAuthStatus, setLoading, setError]);

	return {
		authStatus,
		isOpen,
		initialized,
		fetchAuthStatus,
		checkOnboarding,
		setupWallet,
		importWallet,
		addProvider,
		addCustomProvider,
		removeProvider,
		completeOnboarding,
		startOAuth,
		startOAuthManual,
		exchangeOAuthCode,
		startOpenAIDeviceFlow: apiClient.startOpenAIDeviceFlow.bind(apiClient),
		pollOpenAIDeviceFlow,
		startCopilotDeviceFlow: apiClient.startCopilotDeviceFlow.bind(apiClient),
		pollCopilotDeviceFlow,
		startKimiDeviceFlow: apiClient.startKimiDeviceFlow.bind(apiClient),
		pollKimiDeviceFlow,
		getCopilotAuthMethods: apiClient.getCopilotAuthMethods.bind(apiClient),
		saveCopilotToken,
		importCopilotTokenFromGh,
		getCopilotDiagnostics: apiClient.getCopilotDiagnostics.bind(apiClient),
	};
}
