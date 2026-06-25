import { useCallback, useEffect, useRef, useState } from 'react';
import {
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	Globe2,
	Plus,
	RefreshCw,
	X,
} from 'lucide-react';
import type { ViewerTab } from '../../stores/viewerTabsStore';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import { Button } from '../ui/Button';

const DEFAULT_BROWSER_URL = 'http://localhost:3000';
const DEFAULT_SIMULATOR_URL = 'http://localhost:3200';
const IFRAME_EMBED_TIMEOUT_MS = 6000;

type BrowserViewerTab = Extract<ViewerTab, { type: 'browser' }>;

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
	const iframeRef = useRef<HTMLIFrameElement>(null);
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
	const [isLoading, setIsLoading] = useState(() =>
		isEmbeddableUrl(normalizeBrowserUrl(tab.url)),
	);
	const [loadingProgress, setLoadingProgress] = useState(() =>
		isEmbeddableUrl(normalizeBrowserUrl(tab.url)) ? 12 : 0,
	);
	const [embedError, setEmbedError] = useState<string | null>(null);
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
		if (!isLoading || !canRenderUrl) {
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
	}, [canRenderUrl, clearIframeEmbedTimeout, isLoading]);

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
					</div>
				</div>
			</div>

			<div className="min-h-0 flex-1 bg-muted/20">
				{canRenderUrl && !embedError ? (
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
