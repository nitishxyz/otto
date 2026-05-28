import { useEffect, useRef, useState } from 'react';
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
import { useSimulatorStatus } from '../../hooks/useSimulator';
import { Button } from '../ui/Button';

const DEFAULT_BROWSER_URL = 'http://localhost:3000';
const SIMULATOR_URL = 'http://localhost:3200';

type BrowserViewerTab = Extract<ViewerTab, { type: 'browser' }>;

function normalizeBrowserUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
	return `http://${trimmed}`;
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
	const simulatorStatus = useSimulatorStatus();
	const canGoBack = historyIndex > 0;
	const canGoForward =
		historyIndex >= 0 && historyIndex < historyEntries.length - 1;

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
		},
		[],
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
		const url = simulatorStatus.data?.url ?? SIMULATOR_URL;
		if (
			tab.kind === 'simulator' &&
			simulatorStatus.data?.status === 'connected' &&
			url !== tab.url
		) {
			openBrowserTab(url, {
				kind: 'simulator',
				title: 'Simulator',
			});
		}
	}, [openBrowserTab, simulatorStatus.data, tab.kind, tab.url]);

	const normalizedUrl = normalizeBrowserUrl(tab.url);
	const canRenderUrl = isEmbeddableUrl(normalizedUrl);

	const navigate = (value: string) => {
		const nextUrl = normalizeBrowserUrl(value);
		if (!nextUrl) return;
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
		setIsLoading(isEmbeddableUrl(nextUrl));
		setLoadingProgress(isEmbeddableUrl(nextUrl) ? 12 : 0);
		updateBrowserTabUrl(tab.id, nextUrl);
	};

	const completeLoading = () => {
		setLoadingProgress(100);
		if (loadingDoneTimeoutRef.current) {
			clearTimeout(loadingDoneTimeoutRef.current);
		}
		loadingDoneTimeoutRef.current = setTimeout(() => {
			setIsLoading(false);
			setLoadingProgress(0);
			loadingDoneTimeoutRef.current = null;
		}, 180);
	};

	const stopLoading = () => {
		try {
			iframeRef.current?.contentWindow?.stop();
		} catch {
			// Cross-origin frames may reject access; clearing local loading state is enough.
		}
		setIsLoading(false);
		setLoadingProgress(0);
	};

	const simulatorError =
		tab.kind === 'simulator' && simulatorStatus.data?.status === 'error'
			? simulatorStatus.data.error
			: null;

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
						onClick={() =>
							openBrowserTab(SIMULATOR_URL, {
								kind: 'simulator',
								title: 'Simulator',
							})
						}
						title="Simulator preview"
						className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
					>
						<Smartphone className="h-4 w-4" />
					</button>
				</div>
			</div>
			{simulatorError && (
				<div className="shrink-0 border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
					{simulatorError}
				</div>
			)}

			<div className="min-h-0 flex-1 bg-muted/20">
				{canRenderUrl ? (
					<iframe
						ref={iframeRef}
						key={`${tab.id}:${tab.reloadKey}`}
						title={tab.title}
						src={normalizedUrl}
						onLoad={completeLoading}
						className="h-full w-full border-0 bg-background"
						allow="clipboard-read; clipboard-write; fullscreen; microphone; camera; geolocation; autoplay"
					/>
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
