import { useCallback, useEffect, useRef, useState } from 'react';
import {
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	Globe2,
	Plus,
	RefreshCw,
	Smartphone,
	X,
} from 'lucide-react';
import type { ViewerTab } from '../../stores/viewerTabsStore';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import {
	useSimulatorStatus,
	useStartSimulator,
} from '../../hooks/useSimulator';
import { Button } from '../ui/Button';

const DEFAULT_BROWSER_URL = 'http://localhost:3000';
const SIMULATOR_URL = 'http://localhost:3200';
const SIMULATOR_TAB_ID = 'browser:simulator';
const IFRAME_EMBED_TIMEOUT_MS = 6000;

type BrowserViewerTab = Extract<ViewerTab, { type: 'browser' }>;

interface NativeBrowserBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface NativeBrowserMountOptions {
	id: string;
	url: string;
	reloadKey: number;
	bounds: NativeBrowserBounds;
	visible: boolean;
}

interface NativeBrowserBridge {
	isAvailable: true;
	mount: (options: NativeBrowserMountOptions) => Promise<void>;
	unmount: (id: string) => Promise<void>;
	setVisible: (id: string, visible: boolean) => Promise<void>;
	openWindow?: (url: string) => Promise<void>;
}

declare global {
	interface Window {
		OTTO_NATIVE_BROWSER?: NativeBrowserBridge;
	}
}

function normalizeBrowserUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
	if (
		/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(
			trimmed,
		)
	) {
		return `http://${trimmed}`;
	}
	return `https://${trimmed}`;
}

function isEmbeddableUrl(value: string): boolean {
	if (!value) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

interface BrowserViewerPanelProps {
	tab: BrowserViewerTab;
}

export function BrowserViewerPanel({ tab }: BrowserViewerPanelProps) {
	const updateBrowserTabUrl = useViewerTabsStore(
		(state) => state.updateBrowserTabUrl,
	);
	const reloadBrowserTab = useViewerTabsStore(
		(state) => state.reloadBrowserTab,
	);
	const openBrowserTab = useViewerTabsStore((state) => state.openBrowserTab);
	const contentRef = useRef<HTMLDivElement>(null);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const loadingDoneTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const iframeEmbedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const isLoadingRef = useRef(false);
	const simulatorConnectedRef = useRef(false);
	const [draftUrl, setDraftUrl] = useState(tab.url);
	const [historyEntries, setHistoryEntries] = useState<string[]>(() =>
		tab.url ? [normalizeBrowserUrl(tab.url)] : [],
	);
	const [historyIndex, setHistoryIndex] = useState(tab.url ? 0 : -1);
	const [isLoading, setIsLoading] = useState(() =>
		isEmbeddableUrl(normalizeBrowserUrl(tab.url)),
	);
	const [loadingProgress, setLoadingProgress] = useState(() =>
		isEmbeddableUrl(normalizeBrowserUrl(tab.url)) ? 12 : 0,
	);
	const [embedError, setEmbedError] = useState<string | null>(null);
	const simulatorStatus = useSimulatorStatus();
	const {
		mutate: startSimulatorPreview,
		isPending: isStartingSimulatorPreview,
		error: startSimulatorError,
	} = useStartSimulator();
	const nativeBrowser =
		typeof window !== 'undefined' ? window.OTTO_NATIVE_BROWSER : undefined;
	const normalizedUrl = normalizeBrowserUrl(tab.url);
	const canRenderUrl = isEmbeddableUrl(normalizedUrl);
	const useNativeBrowser = Boolean(nativeBrowser?.isAvailable && canRenderUrl);
	const canGoBack = historyIndex > 0;
	const canGoForward =
		historyIndex >= 0 && historyIndex < historyEntries.length - 1;
	const simulatorStateStatus = simulatorStatus.data?.status;
	const simulatorStateUrl = simulatorStatus.data?.url;
	const simulatorSetupStatus = simulatorStatus.data?.setupStatus;
	const simulatorSetupMessage = simulatorStatus.data?.setupMessage;
	const simulatorRunner = simulatorStatus.data?.runner;
	const isSimulatorPreview = tab.kind === 'simulator';
	const isStartingSimulator =
		isStartingSimulatorPreview ||
		simulatorStateStatus === 'starting' ||
		simulatorSetupStatus === 'preparing';
	const shouldShowSimulatorSetup =
		isSimulatorPreview &&
		(simulatorSetupStatus === 'unsupported' ||
			simulatorSetupStatus === 'missing_runner');
	const simulatorError =
		isSimulatorPreview &&
		!shouldShowSimulatorSetup &&
		simulatorStatus.data?.status === 'error'
			? simulatorStatus.data.error
			: isSimulatorPreview
				? startSimulatorError?.message
				: null;
	const shouldHoldSimulatorPreview =
		isSimulatorPreview &&
		!shouldShowSimulatorSetup &&
		!simulatorError &&
		simulatorStateStatus !== 'connected';

	const clearIframeEmbedTimeout = useCallback(() => {
		if (iframeEmbedTimeoutRef.current) {
			clearTimeout(iframeEmbedTimeoutRef.current);
			iframeEmbedTimeoutRef.current = null;
		}
	}, []);

	const completeLoading = useCallback(() => {
		clearIframeEmbedTimeout();
		setEmbedError(null);
		setLoadingProgress(100);
		if (loadingDoneTimeoutRef.current) {
			clearTimeout(loadingDoneTimeoutRef.current);
		}
		loadingDoneTimeoutRef.current = setTimeout(() => {
			setIsLoading(false);
			setLoadingProgress(0);
			loadingDoneTimeoutRef.current = null;
		}, 180);
	}, [clearIframeEmbedTimeout]);

	useEffect(() => {
		setDraftUrl(tab.url);
	}, [tab.url]);

	useEffect(() => {
		isLoadingRef.current = isLoading;
	}, [isLoading]);

	useEffect(() => {
		if (!isLoading) return;

		setLoadingProgress((progress) =>
			progress <= 0 || progress >= 100 ? 12 : progress,
		);
		const interval = setInterval(() => {
			setLoadingProgress((progress) => {
				if (progress >= 88) return progress;
				return Math.min(88, progress + Math.max(2, (90 - progress) * 0.12));
			});
		}, 250);

		return () => clearInterval(interval);
	}, [isLoading]);

	useEffect(
		() => () => {
			if (loadingDoneTimeoutRef.current) {
				clearTimeout(loadingDoneTimeoutRef.current);
			}
			clearIframeEmbedTimeout();
		},
		[clearIframeEmbedTimeout],
	);

	useEffect(() => {
		if (shouldHoldSimulatorPreview) {
			clearIframeEmbedTimeout();
			return;
		}

		if (!isLoading || !canRenderUrl || useNativeBrowser) {
			clearIframeEmbedTimeout();
			return;
		}
		if (isSimulatorPreview) {
			clearIframeEmbedTimeout();
			return;
		}

		clearIframeEmbedTimeout();
		iframeEmbedTimeoutRef.current = setTimeout(() => {
			setEmbedError(
				'This site may block embedding in Otto, or it took too long to load.',
			);
			setIsLoading(false);
			setLoadingProgress(0);
		}, IFRAME_EMBED_TIMEOUT_MS);

		return clearIframeEmbedTimeout;
	}, [
		canRenderUrl,
		clearIframeEmbedTimeout,
		isSimulatorPreview,
		isLoading,
		shouldHoldSimulatorPreview,
		useNativeBrowser,
	]);

	useEffect(() => {
		if (!shouldHoldSimulatorPreview) return;

		setEmbedError(null);
		setIsLoading(true);
		setLoadingProgress((progress) =>
			progress <= 0 || progress >= 100 ? 12 : progress,
		);
	}, [shouldHoldSimulatorPreview]);

	useEffect(() => {
		if (!isSimulatorPreview) {
			simulatorConnectedRef.current = false;
			return;
		}
		if (simulatorStateStatus !== 'connected') {
			// Reset so the next genuine reconnect shows the loading overlay once.
			simulatorConnectedRef.current = false;
			return;
		}
		// Only react to the transition into "connected", not every poll that keeps
		// reporting "connected" (which would re-show the loading overlay and make
		// the live preview appear to refresh).
		if (simulatorConnectedRef.current) return;
		simulatorConnectedRef.current = true;

		setEmbedError(null);
		setIsLoading(true);
		setLoadingProgress(12);
	}, [isSimulatorPreview, simulatorStateStatus]);

	useEffect(
		() => () => {
			if (nativeBrowser?.isAvailable) {
				void nativeBrowser.unmount(tab.id);
			}
		},
		[nativeBrowser, tab.id],
	);

	useEffect(() => {
		const nextUrl = normalizeBrowserUrl(tab.url);
		if (!nextUrl) return;

		setHistoryEntries((entries) => {
			if (entries[historyIndex] === nextUrl) return entries;
			const nextEntries = entries.slice(0, historyIndex + 1);
			nextEntries.push(nextUrl);
			setHistoryIndex(nextEntries.length - 1);
			setIsLoading(isEmbeddableUrl(nextUrl));
			return nextEntries;
		});
	}, [tab.url, historyIndex]);

	useEffect(() => {
		if (tab.kind !== 'simulator' || simulatorStateStatus !== 'connected') {
			return;
		}
		const nextUrl = simulatorStateUrl ?? SIMULATOR_URL;
		// Update the existing simulator tab's URL in place. Using
		// updateBrowserTabUrl (instead of openBrowserTab) avoids stealing focus or
		// remounting the iframe on every status poll.
		if (nextUrl !== tab.url) {
			updateBrowserTabUrl(tab.id, nextUrl);
		}
	}, [
		updateBrowserTabUrl,
		simulatorStateStatus,
		simulatorStateUrl,
		tab.kind,
		tab.id,
		tab.url,
	]);

	useEffect(() => {
		if (!useNativeBrowser || !nativeBrowser?.isAvailable) return;
		const content = contentRef.current;
		if (!content) return;

		let cancelled = false;
		const mountNativeBrowser = () => {
			const rect = content.getBoundingClientRect();
			const visible = rect.width > 1 && rect.height > 1;
			if (!visible) {
				void nativeBrowser.setVisible(tab.id, false);
				return;
			}

			void nativeBrowser
				.mount({
					id: tab.id,
					url: normalizedUrl,
					reloadKey: tab.reloadKey,
					bounds: {
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height,
					},
					visible,
				})
				.then(() => {
					if (!cancelled && isLoadingRef.current) completeLoading();
				})
				.catch((error) => {
					if (cancelled) return;
					const message =
						error instanceof Error
							? error.message
							: 'Unable to open the native desktop webview.';
					setEmbedError(message);
					setIsLoading(false);
					setLoadingProgress(0);
				});
		};

		mountNativeBrowser();
		const resizeObserver = new ResizeObserver(mountNativeBrowser);
		resizeObserver.observe(content);
		window.addEventListener('resize', mountNativeBrowser);
		return () => {
			cancelled = true;
			resizeObserver.disconnect();
			window.removeEventListener('resize', mountNativeBrowser);
		};
	}, [
		completeLoading,
		nativeBrowser,
		normalizedUrl,
		tab.id,
		tab.reloadKey,
		useNativeBrowser,
	]);

	const navigate = (value: string) => {
		const nextUrl = normalizeBrowserUrl(value);
		if (!nextUrl) return;
		setEmbedError(null);
		setIsLoading(isEmbeddableUrl(nextUrl));
		setLoadingProgress(isEmbeddableUrl(nextUrl) ? 12 : 0);
		setHistoryEntries((entries) => {
			const currentUrl = entries[historyIndex];
			if (currentUrl === nextUrl) return entries;
			const nextEntries = entries.slice(0, historyIndex + 1);
			nextEntries.push(nextUrl);
			setHistoryIndex(nextEntries.length - 1);
			return nextEntries;
		});
		updateBrowserTabUrl(tab.id, nextUrl);
	};

	const goToHistoryIndex = (index: number) => {
		const nextUrl = historyEntries[index];
		if (!nextUrl) return;
		setHistoryIndex(index);
		setEmbedError(null);
		setIsLoading(isEmbeddableUrl(nextUrl));
		setLoadingProgress(isEmbeddableUrl(nextUrl) ? 12 : 0);
		updateBrowserTabUrl(tab.id, nextUrl);
	};

	const stopLoading = () => {
		try {
			iframeRef.current?.contentWindow?.stop();
		} catch {
			// Cross-origin frames may reject access; clearing local loading state is enough.
		}
		setIsLoading(false);
		setLoadingProgress(0);
		clearIframeEmbedTimeout();
		if (nativeBrowser?.isAvailable) {
			void nativeBrowser.setVisible(tab.id, false);
		}
	};

	const openSimulatorPreview = useCallback(() => {
		const previewUrl = simulatorStateUrl ?? SIMULATOR_URL;
		openBrowserTab(previewUrl, {
			kind: 'simulator',
			title: 'Simulator',
		});

		if (
			simulatorStateStatus === 'connected' ||
			simulatorStateStatus === 'starting' ||
			isStartingSimulatorPreview
		) {
			return;
		}

		startSimulatorPreview(3200, {
			onSuccess: (result) => {
				openBrowserTab(result.url ?? SIMULATOR_URL, {
					kind: 'simulator',
					title: 'Simulator',
				});
				reloadBrowserTab(SIMULATOR_TAB_ID);
			},
		});
	}, [
		isStartingSimulatorPreview,
		openBrowserTab,
		reloadBrowserTab,
		simulatorStateStatus,
		simulatorStateUrl,
		startSimulatorPreview,
	]);

	return (
		<div className="h-full w-full min-w-0 bg-background flex flex-col">
			<div className="shrink-0 border-b border-border bg-sidebar text-muted-foreground">
				<div className="relative flex h-11 items-center gap-1 px-3">
					<button
						type="button"
						onClick={() => goToHistoryIndex(historyIndex - 1)}
						disabled={!canGoBack}
						className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:text-muted-foreground/40 disabled:hover:bg-transparent"
						title="Back"
					>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => goToHistoryIndex(historyIndex + 1)}
						disabled={!canGoForward}
						className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:text-muted-foreground/40 disabled:hover:bg-transparent"
						title="Forward"
					>
						<ChevronRight className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => {
							if (isLoading) {
								stopLoading();
								return;
							}
							setEmbedError(null);
							setIsLoading(true);
							setLoadingProgress(12);
							reloadBrowserTab(tab.id);
						}}
						disabled={!isLoading && !canRenderUrl}
						title={isLoading ? 'Stop loading' : 'Reload'}
						className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:text-muted-foreground/40 disabled:hover:bg-transparent"
					>
						{isLoading ? (
							<X className="h-4 w-4" />
						) : (
							<RefreshCw className="h-4 w-4" />
						)}
					</button>
					<form
						className="relative mx-2 min-w-48 flex-1"
						onSubmit={(event) => {
							event.preventDefault();
							navigate(draftUrl);
						}}
					>
						<div className="relative h-8 overflow-hidden rounded-md border border-input bg-muted/30 focus-within:border-ring">
							{loadingProgress > 0 && (
								<div
									className="absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-200 ease-out"
									style={{ width: `${loadingProgress}%` }}
								/>
							)}
							<input
								value={draftUrl}
								onChange={(event) => setDraftUrl(event.target.value)}
								placeholder="localhost:3000 or https://example.com"
								className="relative z-10 h-full w-full bg-transparent px-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
							/>
						</div>
					</form>
					<div
						className="flex shrink-0 items-center gap-1"
						data-smart-edge-ignore="right"
					>
						<button
							type="button"
							onClick={() =>
								window.open(normalizedUrl, '_blank', 'noopener,noreferrer')
							}
							disabled={!canRenderUrl}
							title="Open externally"
							className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:text-muted-foreground/40 disabled:hover:bg-transparent"
						>
							<ExternalLink className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() =>
								openBrowserTab('', {
									kind: 'browser',
									title: 'Browser',
									newTab: true,
								})
							}
							title="New browser preview"
							className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
						>
							<Plus className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={openSimulatorPreview}
							title={
								isStartingSimulator
									? 'Starting simulator preview'
									: 'Start simulator preview'
							}
							className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
						>
							<Smartphone
								className={`h-4 w-4 ${isStartingSimulator ? 'animate-pulse' : ''}`}
							/>
						</button>
					</div>
				</div>
			</div>
			{simulatorError && (
				<div className="shrink-0 border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
					{simulatorError}
				</div>
			)}

			<div ref={contentRef} className="min-h-0 flex-1 bg-muted/20">
				{shouldShowSimulatorSetup ? (
					<div className="h-full w-full flex items-center justify-center p-6 text-center">
						<div className="max-w-md rounded-lg border border-border bg-background p-6 shadow-sm">
							<Smartphone className="mx-auto mb-3 h-8 w-8 text-violet-500" />
							<h2 className="mb-2 text-sm font-semibold text-foreground">
								{simulatorSetupStatus === 'unsupported'
									? 'Simulator preview requires macOS'
									: 'serve-sim runner is not available'}
							</h2>
							<p className="mb-4 text-xs leading-relaxed text-muted-foreground">
								{simulatorSetupMessage ??
									'Install Bun or Node.js so Otto can run serve-sim@latest without bundling it into the CLI.'}
							</p>
							{simulatorSetupStatus === 'missing_runner' && (
								<div className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-left font-mono text-[11px] text-muted-foreground">
									bun x serve-sim@latest --version
									<br />
									npx --yes serve-sim@latest --version
								</div>
							)}
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={openSimulatorPreview}
							>
								Check again
							</Button>
						</div>
					</div>
				) : shouldHoldSimulatorPreview ? (
					<div className="h-full w-full flex items-center justify-center p-6 text-center">
						<div className="max-w-md rounded-lg border border-border bg-background p-6 shadow-sm">
							<Smartphone className="mx-auto mb-3 h-8 w-8 animate-pulse text-violet-500" />
							<h2 className="mb-2 text-sm font-semibold text-foreground">
								{isStartingSimulator || simulatorStatus.isLoading
									? 'Starting simulator preview'
									: 'Simulator preview is not running'}
							</h2>
							<p className="mb-4 text-xs leading-relaxed text-muted-foreground">
								{isStartingSimulator || simulatorStatus.isLoading
									? `Otto is running ${simulatorRunner ?? 'serve-sim@latest'} and waiting for a preview URL.`
									: 'Start serve-sim@latest before loading the simulator web preview.'}
							</p>
							{!isStartingSimulator && !simulatorStatus.isLoading && (
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={openSimulatorPreview}
								>
									Start simulator
								</Button>
							)}
						</div>
					</div>
				) : useNativeBrowser && canRenderUrl ? (
					<div className="h-full w-full bg-background" />
				) : canRenderUrl && !embedError ? (
					<iframe
						ref={iframeRef}
						key={`${tab.id}:${tab.reloadKey}`}
						title={tab.title}
						src={normalizedUrl}
						onLoad={completeLoading}
						className="h-full w-full border-0 bg-background"
						allow="clipboard-read; clipboard-write; fullscreen; microphone; camera; geolocation; autoplay"
					/>
				) : embedError ? (
					<div className="h-full w-full flex items-center justify-center p-6 text-center">
						<div className="max-w-md rounded-lg border border-border bg-background p-6 shadow-sm">
							<Globe2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
							<h2 className="mb-2 text-sm font-semibold text-foreground">
								This site can't be embedded
							</h2>
							<p className="mb-4 text-xs leading-relaxed text-muted-foreground">
								{embedError}
							</p>
							<div className="flex flex-wrap justify-center gap-2">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => {
										setEmbedError(null);
										setIsLoading(true);
										setLoadingProgress(12);
										reloadBrowserTab(tab.id);
									}}
								>
									Try again
								</Button>
								{nativeBrowser?.openWindow && (
									<Button
										type="button"
										variant="secondary"
										size="sm"
										onClick={() => nativeBrowser.openWindow?.(normalizedUrl)}
									>
										Open in desktop window
									</Button>
								)}
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() =>
										window.open(normalizedUrl, '_blank', 'noopener,noreferrer')
									}
								>
									Open externally
								</Button>
							</div>
						</div>
					</div>
				) : (
					<div className="h-full w-full flex items-center justify-center p-6 text-center">
						<div className="max-w-md rounded-lg border border-border bg-background p-6 shadow-sm">
							<Globe2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
							<h2 className="mb-2 text-sm font-semibold text-foreground">
								Open a browser preview
							</h2>
							<p className="mb-4 text-xs leading-relaxed text-muted-foreground">
								Preview localhost apps or hosted URLs. Simulator previews open
								when serve-sim is started by the agent.
							</p>
							<div className="flex flex-wrap justify-center gap-2">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => navigate(DEFAULT_BROWSER_URL)}
								>
									localhost:3000
								</Button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
