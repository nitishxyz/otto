import { useState, useEffect, useRef, useCallback } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useServer } from '../../hooks/useServer';
import { usePlatform } from '../../hooks/usePlatform';
import { DesktopDragRegion } from '../DesktopDragRegion';
import { tauriOnboarding } from '../../lib/tauri-onboarding';
import { OttoRouterLoader } from '../OttoRouterLoader';
import { WindowControls } from '../WindowControls';
import {
	OnboardingModal,
	OttoRouterTopupModal,
	Toaster,
} from '@ottocode/web-sdk';
import { useOnboardingStore } from '@ottocode/web-sdk/stores';
import { useAuthStatus } from '@ottocode/web-sdk/hooks';
import { configureDesktopSdk } from '../../lib/sdk-client';

interface NativeOnboardingProps {
	onComplete: () => void;
}

export function NativeOnboarding({ onComplete }: NativeOnboardingProps) {
	const [serverReady, setServerReady] = useState(false);
	const [homePath, setHomePath] = useState<string | null>(null);
	const platform = usePlatform();
	const currentStep = useOnboardingStore((s) => s.currentStep);
	const {
		server,
		loading: serverLoading,
		error: serverError,
		startServer,
		stopServer,
	} = useServer();
	const startedRef = useRef(false);
	const isOpen = useOnboardingStore((s) => s.isOpen);
	const { checkOnboarding, fetchAuthStatus } = useAuthStatus();
	const onboardingError = useOnboardingStore((s) => s.error);
	const onboardingLoading = useOnboardingStore((s) => s.isLoading);
	const hasBeenOpened = useRef(false);
	const oauthPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const oauthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const preOauthProvidersRef = useRef<Set<string>>(new Set());
	const authStatus = useOnboardingStore((s) => s.authStatus);

	const startOAuthPolling = useCallback(() => {
		if (oauthPollingRef.current) return;
		const status = useOnboardingStore.getState().authStatus;
		if (status) {
			preOauthProvidersRef.current = new Set(
				Object.entries(status.providers)
					.filter(([, p]) => p.configured)
					.map(([id]) => id),
			);
		}
		oauthPollingRef.current = setInterval(() => {
			fetchAuthStatus();
		}, 3000);
		oauthTimeoutRef.current = setTimeout(() => {
			if (oauthPollingRef.current) {
				clearInterval(oauthPollingRef.current);
				oauthPollingRef.current = null;
			}
		}, 300000);
	}, [fetchAuthStatus]);

	useEffect(() => {
		if (!authStatus || !oauthPollingRef.current) return;
		const hasNewProvider = Object.entries(authStatus.providers)
			.filter(([, p]) => p.configured)
			.some(([id]) => !preOauthProvidersRef.current.has(id));
		if (hasNewProvider) {
			clearInterval(oauthPollingRef.current);
			oauthPollingRef.current = null;
			if (oauthTimeoutRef.current) {
				clearTimeout(oauthTimeoutRef.current);
				oauthTimeoutRef.current = null;
			}
		}
	}, [authStatus]);

	useEffect(() => {
		return () => {
			if (oauthPollingRef.current) clearInterval(oauthPollingRef.current);
			if (oauthTimeoutRef.current) clearTimeout(oauthTimeoutRef.current);
		};
	}, []);

	useEffect(() => {
		const originalOpen = window.open.bind(window);
		window.open = (
			url?: string | URL,
			_target?: string,
			_features?: string,
		) => {
			if (url) {
				const urlStr = typeof url === 'string' ? url : url.toString();
				openUrl(urlStr).catch((err: unknown) => {
					console.error('[otto] Failed to open URL:', err);
				});
				if (urlStr.includes('/oauth/') || urlStr.includes('/auth/')) {
					startOAuthPolling();
				}
			}
			return null;
		};
		return () => {
			window.open = originalOpen;
		};
	}, [startOAuthPolling]);

	useEffect(() => {
		tauriOnboarding
			.getHomeDirectory()
			.then(setHomePath)
			.catch(() => setHomePath('/tmp'));
	}, []);

	useEffect(() => {
		if (!homePath || startedRef.current) return;
		startedRef.current = true;
		startServer(homePath);
	}, [homePath, startServer]);

	useEffect(() => {
		if (!server) return;
		configureDesktopSdk(server.url, server);
		setServerReady(true);
	}, [server]);

	useEffect(() => {
		if (serverReady) {
			checkOnboarding();
		}
	}, [serverReady, checkOnboarding]);

	useEffect(() => {
		if (isOpen) {
			hasBeenOpened.current = true;
		} else if (hasBeenOpened.current && serverReady) {
			stopServer().then(() => onComplete());
		}
	}, [isOpen, serverReady, stopServer, onComplete]);

	useEffect(() => {
		const handler = (e: MessageEvent) => {
			if (e.data?.type === 'otto-open-url' && typeof e.data.url === 'string') {
				openUrl(e.data.url).catch((err: unknown) => {
					console.error('[otto] Failed to open URL:', err);
				});
				if (e.data.url.includes('/oauth/') || e.data.url.includes('/auth/')) {
					startOAuthPolling();
				}
			}
		};
		window.addEventListener('message', handler);
		return () => window.removeEventListener('message', handler);
	}, [startOAuthPolling]);

	if (!serverReady) {
		return (
			<div className="min-h-screen flex flex-col items-center justify-center gap-4">
				<OttoRouterLoader
					label={
						serverError
							? serverError
							: serverLoading
								? 'Starting server...'
								: 'Preparing...'
					}
				/>
				{serverError && (
					<button
						type="button"
						onClick={() => {
							startedRef.current = false;
							if (homePath) startServer(homePath);
						}}
						className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
					>
						Retry
					</button>
				)}
			</div>
		);
	}

	return (
		<>
			<DesktopDragRegion className="shrink-0 flex items-center px-4 h-12 border-b border-border cursor-default select-none fixed top-0 left-0 right-0 z-[10000] bg-background relative">
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
					<span className="font-semibold text-base text-foreground">otto</span>
				</div>
				<div className="flex items-center gap-2 text-base text-muted-foreground ml-auto">
					<span
						className={`w-2.5 h-2.5 rounded-full ${currentStep === 'wallet' ? 'bg-green-500' : 'bg-blue-500'}`}
					/>
					{currentStep === 'wallet' ? 'Step 1 of 2' : 'Step 2 of 2'}
					{platform === 'linux' && <WindowControls />}
				</div>
			</DesktopDragRegion>
			<div className="pt-12">
				<OnboardingModal hideHeader />
				{!isOpen && !onboardingLoading && onboardingError && (
					<div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
						<p className="text-sm text-destructive">{onboardingError}</p>
						<button
							type="button"
							onClick={() => checkOnboarding()}
							className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
						>
							Retry
						</button>
					</div>
				)}
				{!isOpen && onboardingLoading && (
					<div className="flex items-center justify-center min-h-[60vh]">
						<OttoRouterLoader label="Loading..." />
					</div>
				)}
			</div>
			<OttoRouterTopupModal />
			<Toaster />
		</>
	);
}
