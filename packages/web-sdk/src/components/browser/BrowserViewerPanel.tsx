import { useCallback, useEffect, useRef, useState } from 'react';
import {
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	Globe2,
	RefreshCw,
	X,
} from 'lucide-react';
import type { ViewerTab } from '../../stores/viewerTabsStore';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import { toast } from '../../stores/toastStore';
import { connectBrowserController } from '../../lib/browser/controller';
import { subscribeNativeOverlay } from '../../lib/native-overlay';
import { Button } from '../ui/Button';

const DEFAULT_BROWSER_URL = 'http://localhost:3000';
const DEFAULT_SIMULATOR_URL = 'http://localhost:3200';
const IFRAME_EMBED_TIMEOUT_MS = 6000;
/**
 * Keeps the native page clear of the viewer resize handle on the left and the
 * terminals panel resize handle along the bottom edge.
 */
const NATIVE_HANDLE_GUTTER_CLASS = 'pl-1 pb-1';

type BrowserViewerTab = Extract<ViewerTab, { type: 'browser' }>;

interface NativeBrowserBridge {
	isAvailable: true;
	mount(options: {
		id: string;
		url: string;
		reloadKey: number;
		bounds: { x: number; y: number; width: number; height: number };
		visible: boolean;
	}): Promise<void>;
	unmount(id: string): Promise<void>;
	setVisible(id: string, visible: boolean): Promise<void>;
	control(
		id: string,
		action: 'navigate' | 'back' | 'forward' | 'reload' | 'stop',
		url?: string,
	): Promise<void>;
	execute(id: string, script: string): Promise<unknown>;
	screenshot(id: string): Promise<string>;
	subscribe(
		id: string,
		listener: (event: { id: string; url: string; loading: boolean }) => void,
	): () => void;
	subscribeNewTab(
		id: string,
		listener: (event: { id: string; url: string }) => void,
	): () => void;
	subscribeDownload(
		id: string,
		listener: (event: {
			id: string;
			url: string;
			status: 'requested' | 'finished';
			path?: string | null;
			success?: boolean | null;
		}) => void,
	): () => void;
	openWindow(url: string): Promise<void>;
}

function getNativeBrowserBridge(): NativeBrowserBridge | undefined {
	if (typeof window === 'undefined') return undefined;
	return (
		window as typeof window & { OTTO_NATIVE_BROWSER?: NativeBrowserBridge }
	).OTTO_NATIVE_BROWSER;
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

function decodeNativePageUrl(value: unknown): string | null {
	let decoded = value;
	for (let index = 0; index < 2 && typeof decoded === 'string'; index += 1) {
		try {
			decoded = JSON.parse(decoded);
		} catch {
			return null;
		}
	}
	if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
		return null;
	}
	const url = (decoded as { url?: unknown }).url;
	return typeof url === 'string' ? url : null;
}

function downloadName(path: string | null | undefined, url: string): string {
	const fromPath = path?.split(/[\\/]/).filter(Boolean).pop();
	if (fromPath) return fromPath;
	try {
		return new URL(url).pathname.split('/').filter(Boolean).pop() || 'file';
	} catch {
		return 'file';
	}
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
	isActive?: boolean;
}

export function BrowserViewerPanel({
	tab,
	isActive = true,
}: BrowserViewerPanelProps) {
	const updateBrowserTabUrl = useViewerTabsStore(
		(state) => state.updateBrowserTabUrl,
	);
	const reloadBrowserTab = useViewerTabsStore(
		(state) => state.reloadBrowserTab,
	);
	const openBrowserTab = useViewerTabsStore((state) => state.openBrowserTab);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const nativeHostRef = useRef<HTMLDivElement>(null);
	const nativeBridge = getNativeBrowserBridge();
	const nativeMountedRef = useRef(false);
	const observedNativeUrlRef = useRef(normalizeBrowserUrl(tab.url));
	const requestedTabUrlRef = useRef(normalizeBrowserUrl(tab.url));
	const pendingHistoryIndexRef = useRef<number | null>(null);
	const downloadNamesRef = useRef(new Map<string, string>());
	const loadingDoneTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const iframeEmbedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const [draftUrl, setDraftUrl] = useState(tab.url);
	const [historyEntries, setHistoryEntries] = useState<string[]>(() =>
		tab.url ? [normalizeBrowserUrl(tab.url)] : [],
	);
	const [historyIndex, setHistoryIndex] = useState(tab.url ? 0 : -1);
	const historyIndexRef = useRef(tab.url ? 0 : -1);
	const [isLoading, setIsLoading] = useState(() =>
		isEmbeddableUrl(normalizeBrowserUrl(tab.url)),
	);
	const [loadingProgress, setLoadingProgress] = useState(() =>
		isEmbeddableUrl(normalizeBrowserUrl(tab.url)) ? 12 : 0,
	);
	const [embedError, setEmbedError] = useState<string | null>(null);
	const [nativeOverlayOpen, setNativeOverlayOpen] = useState(false);
	const normalizedUrl = normalizeBrowserUrl(tab.url);
	const canRenderUrl = isEmbeddableUrl(normalizedUrl);
	const canGoBack = historyIndex > 0;
	const canGoForward =
		historyIndex >= 0 && historyIndex < historyEntries.length - 1;

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

	const selectHistoryIndex = useCallback((index: number) => {
		historyIndexRef.current = index;
		setHistoryIndex(index);
	}, []);

	const recordNativeNavigation = useCallback(
		(value: string) => {
			const nextUrl = normalizeBrowserUrl(value);
			if (!isEmbeddableUrl(nextUrl)) return;
			observedNativeUrlRef.current = nextUrl;
			setDraftUrl(nextUrl);
			setHistoryEntries((entries) => {
				const currentIndex = historyIndexRef.current;
				const pendingIndex = pendingHistoryIndexRef.current;
				if (pendingIndex !== null && entries[pendingIndex] === nextUrl) {
					pendingHistoryIndexRef.current = null;
					selectHistoryIndex(pendingIndex);
					return entries;
				}
				if (entries[currentIndex] === nextUrl) return entries;
				if (entries[currentIndex - 1] === nextUrl) {
					selectHistoryIndex(currentIndex - 1);
					return entries;
				}
				if (entries[currentIndex + 1] === nextUrl) {
					selectHistoryIndex(currentIndex + 1);
					return entries;
				}
				pendingHistoryIndexRef.current = null;
				const nextEntries = entries.slice(0, currentIndex + 1);
				nextEntries.push(nextUrl);
				selectHistoryIndex(nextEntries.length - 1);
				return nextEntries;
			});

			const currentTab = useViewerTabsStore.getState().tabsById[tab.id];
			if (currentTab?.type === 'browser' && currentTab.url !== nextUrl) {
				updateBrowserTabUrl(tab.id, nextUrl);
			}
		},
		[selectHistoryIndex, tab.id, updateBrowserTabUrl],
	);

	useEffect(() => {
		setDraftUrl(tab.url);
	}, [tab.url]);

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
		if (nativeBridge || !isLoading || !canRenderUrl) {
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
	}, [canRenderUrl, clearIframeEmbedTimeout, isLoading, nativeBridge]);

	useEffect(() => {
		if (!nativeBridge) return;
		return subscribeNativeOverlay(setNativeOverlayOpen);
	}, [nativeBridge]);

	useEffect(() => {
		if (!nativeBridge || !canRenderUrl || embedError) return;
		const host = nativeHostRef.current;
		if (!host) return;
		let frame = 0;
		let disposed = false;

		const syncNativeWebview = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				if (disposed) return;
				const bounds = host.getBoundingClientRect();
				const mountUrl =
					observedNativeUrlRef.current || requestedTabUrlRef.current;
				void nativeBridge
					.mount({
						id: tab.id,
						url: mountUrl,
						reloadKey: 0,
						bounds: {
							x: bounds.x,
							y: bounds.y,
							width: bounds.width,
							height: bounds.height,
						},
						visible:
							isActive &&
							!nativeOverlayOpen &&
							bounds.width > 0 &&
							bounds.height > 0,
					})
					.then(() => {
						nativeMountedRef.current = true;
						const requestedUrl = requestedTabUrlRef.current;
						if (requestedUrl && requestedUrl !== mountUrl) {
							void nativeBridge
								.control(tab.id, 'navigate', requestedUrl)
								.catch((error) => {
									if (disposed) return;
									setEmbedError(
										error instanceof Error
											? error.message
											: 'Failed to navigate the native browser view.',
									);
									setIsLoading(false);
									setLoadingProgress(0);
								});
						}
					})
					.catch((error) => {
						if (disposed) return;
						setEmbedError(
							error instanceof Error
								? error.message
								: 'Failed to mount the native browser view.',
						);
						setIsLoading(false);
						setLoadingProgress(0);
					});
			});
		};

		const observer = new ResizeObserver(syncNativeWebview);
		observer.observe(host);
		window.addEventListener('resize', syncNativeWebview);
		window.addEventListener('scroll', syncNativeWebview, true);
		syncNativeWebview();

		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener('resize', syncNativeWebview);
			window.removeEventListener('scroll', syncNativeWebview, true);
			void nativeBridge.setVisible(tab.id, false);
		};
	}, [
		canRenderUrl,
		embedError,
		isActive,
		nativeBridge,
		nativeOverlayOpen,
		tab.id,
	]);

	useEffect(
		() => () => {
			if (nativeBridge) {
				nativeMountedRef.current = false;
				void nativeBridge.unmount(tab.id);
			}
		},
		[nativeBridge, tab.id],
	);

	useEffect(() => {
		if (!nativeBridge) return;
		return nativeBridge.subscribe(tab.id, (event) => {
			if (event.loading) {
				setEmbedError(null);
				setIsLoading(true);
				setLoadingProgress(12);
			} else {
				recordNativeNavigation(event.url);
				completeLoading();
			}
		});
	}, [completeLoading, nativeBridge, recordNativeNavigation, tab.id]);

	useEffect(() => {
		if (!nativeBridge) return;
		return nativeBridge.subscribeNewTab(tab.id, (event) => {
			openBrowserTab(event.url, {
				kind: 'browser',
				title: 'Browser',
				newTab: true,
			});
		});
	}, [nativeBridge, openBrowserTab, tab.id]);

	useEffect(() => {
		if (!nativeBridge) return;
		return nativeBridge.subscribeDownload(tab.id, (event) => {
			if (event.status === 'requested') {
				const name = downloadName(event.path, event.url);
				downloadNamesRef.current.set(event.url, name);
				toast.info(`Downloading ${name}…`);
			} else if (event.success) {
				const name =
					downloadNamesRef.current.get(event.url) ??
					downloadName(event.path, event.url);
				downloadNamesRef.current.delete(event.url);
				toast.success(`Downloaded ${name} to Downloads`);
			} else {
				const name =
					downloadNamesRef.current.get(event.url) ??
					downloadName(event.path, event.url);
				downloadNamesRef.current.delete(event.url);
				toast.error(`Failed to download ${name}`);
			}
		});
	}, [nativeBridge, tab.id]);

	useEffect(() => {
		if (!nativeBridge || !isActive || !canRenderUrl) return;
		let disposed = false;
		const syncSpaNavigation = async () => {
			try {
				const result = await nativeBridge.execute(
					tab.id,
					'JSON.stringify({ url: location.href })',
				);
				if (disposed) return;
				const pageUrl = decodeNativePageUrl(result);
				if (
					pageUrl &&
					normalizeBrowserUrl(pageUrl) !== observedNativeUrlRef.current
				) {
					recordNativeNavigation(pageUrl);
				}
			} catch {
				// The webview may be between documents; page-load events will retry state.
			}
		};
		const interval = setInterval(syncSpaNavigation, 1_000);
		void syncSpaNavigation();
		return () => {
			disposed = true;
			clearInterval(interval);
		};
	}, [canRenderUrl, isActive, nativeBridge, recordNativeNavigation, tab.id]);

	useEffect(() => {
		if (!nativeBridge || !canRenderUrl) return;
		const previousRequestedUrl = requestedTabUrlRef.current;
		requestedTabUrlRef.current = normalizedUrl;
		if (
			!nativeMountedRef.current ||
			previousRequestedUrl === normalizedUrl ||
			observedNativeUrlRef.current === normalizedUrl
		) {
			return;
		}
		setEmbedError(null);
		setIsLoading(true);
		setLoadingProgress(12);
		void nativeBridge
			.control(tab.id, 'navigate', normalizedUrl)
			.catch((error) => {
				setEmbedError(
					error instanceof Error
						? error.message
						: 'Failed to navigate the native browser view.',
				);
				setIsLoading(false);
				setLoadingProgress(0);
			});
	}, [canRenderUrl, nativeBridge, normalizedUrl, tab.id]);

	useEffect(() => {
		return connectBrowserController(tab.id, {
			metadata: () => {
				const current = useViewerTabsStore.getState().tabsById[tab.id];
				if (current?.type !== 'browser') return {};
				return {
					url: normalizeBrowserUrl(current.url) || undefined,
					title: current.title,
					kind: current.kind,
				};
			},
			execute: (script) => {
				if (nativeBridge) return nativeBridge.execute(tab.id, script);
				const page = iframeRef.current?.contentWindow;
				if (!page) throw new Error('Browser page is not mounted');
				try {
					return Promise.resolve(
						(page as Window & { eval(source: string): unknown }).eval(script),
					);
				} catch {
					throw new Error(
						'This web client cannot inspect a cross-origin page. Use the Otto desktop app for full browser control.',
					);
				}
			},
			capture: nativeBridge
				? async () => ({
						data: await nativeBridge.screenshot(tab.id),
						mediaType: 'image/png',
					})
				: undefined,
			openTab: async (url) => {
				const tabId = `browser:page:${crypto.randomUUID()}`;
				openBrowserTab(url, {
					id: tabId,
					kind: 'browser',
					title: 'Browser',
					newTab: true,
				});
				return tabId;
			},
		});
	}, [nativeBridge, openBrowserTab, tab.id]);

	useEffect(() => {
		if (nativeBridge) return;
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
	}, [historyIndex, nativeBridge, tab.url]);

	const navigate = (value: string) => {
		const nextUrl = normalizeBrowserUrl(value);
		if (!nextUrl) return;
		setEmbedError(null);
		setIsLoading(isEmbeddableUrl(nextUrl));
		setLoadingProgress(isEmbeddableUrl(nextUrl) ? 12 : 0);
		if (nativeBridge) {
			// Updating the tab first lets an empty preview mount its native webview.
			// The URL synchronization effect navigates an already-mounted webview.
			updateBrowserTabUrl(tab.id, nextUrl);
			return;
		}
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
		if (nativeBridge) {
			pendingHistoryIndexRef.current = index;
			setEmbedError(null);
			setIsLoading(true);
			setLoadingProgress(12);
			void nativeBridge.control(
				tab.id,
				index < historyIndex ? 'back' : 'forward',
			);
			return;
		}
		selectHistoryIndex(index);
		setEmbedError(null);
		setIsLoading(isEmbeddableUrl(nextUrl));
		setLoadingProgress(isEmbeddableUrl(nextUrl) ? 12 : 0);
		updateBrowserTabUrl(tab.id, nextUrl);
	};

	const openExternally = () => {
		if (nativeBridge) {
			void nativeBridge.openWindow(normalizedUrl);
			return;
		}
		window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
	};

	const stopLoading = () => {
		if (nativeBridge) void nativeBridge.control(tab.id, 'stop');
		try {
			iframeRef.current?.contentWindow?.stop();
		} catch {
			// Cross-origin frames may reject access; clearing local loading state is enough.
		}
		setIsLoading(false);
		setLoadingProgress(0);
		clearIframeEmbedTimeout();
	};

	const reloadPage = () => {
		setEmbedError(null);
		setIsLoading(true);
		setLoadingProgress(12);
		if (nativeBridge) {
			void nativeBridge.control(tab.id, 'reload');
			return;
		}
		reloadBrowserTab(tab.id);
	};

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
							reloadPage();
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
					<div className="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onClick={openExternally}
							disabled={!canRenderUrl}
							title="Open externally"
							className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground disabled:text-muted-foreground/40 disabled:hover:bg-transparent"
						>
							<ExternalLink className="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>

			<div className="min-h-0 flex-1 bg-muted/20">
				{canRenderUrl && !embedError && nativeBridge ? (
					// Native child webviews always paint above the DOM, so inset the page
					// by the panel resize handles' hit area to keep them grabbable.
					<div className={`h-full w-full ${NATIVE_HANDLE_GUTTER_CLASS}`}>
						<div ref={nativeHostRef} className="h-full w-full bg-background" />
					</div>
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
									onClick={reloadPage}
								>
									Try again
								</Button>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={openExternally}
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
								Preview localhost apps or hosted URLs. For iOS Simulator, start
								serve-sim in a terminal and open its preview URL here.
							</p>
							<div className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-left font-mono text-[11px] text-muted-foreground">
								bun x serve-sim@latest --port 3200
								<br />
								open {DEFAULT_SIMULATOR_URL}
							</div>
							<div className="flex flex-wrap justify-center gap-2">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => navigate(DEFAULT_BROWSER_URL)}
								>
									localhost:3000
								</Button>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => navigate(DEFAULT_SIMULATOR_URL)}
								>
									serve-sim:3200
								</Button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
