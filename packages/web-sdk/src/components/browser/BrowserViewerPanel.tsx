import { useEffect, useState } from 'react';
import {
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	Globe2,
	Plus,
	RefreshCw,
	Smartphone,
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
	const [draftUrl, setDraftUrl] = useState(tab.url);
	const simulatorStatus = useSimulatorStatus();

	useEffect(() => {
		setDraftUrl(tab.url);
	}, [tab.url]);

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
		updateBrowserTabUrl(tab.id, nextUrl);
	};

	const simulatorError =
		tab.kind === 'simulator' && simulatorStatus.data?.status === 'error'
			? simulatorStatus.data.error
			: null;

	return (
		<div className="h-full w-full min-w-0 bg-background flex flex-col">
			<div className="shrink-0 border-b border-border bg-[#0b0b0d] text-zinc-400">
				<div className="flex h-11 items-center gap-1 px-3">
					<button
						type="button"
						disabled
						className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600"
						title="Back"
					>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<button
						type="button"
						disabled
						className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600"
						title="Forward"
					>
						<ChevronRight className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => reloadBrowserTab(tab.id)}
						disabled={!canRenderUrl}
						title="Reload"
						className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:text-zinc-600 disabled:hover:bg-transparent"
					>
						<RefreshCw className="h-4 w-4" />
					</button>
					<form
						className="mx-2 min-w-48 flex-1"
						onSubmit={(event) => {
							event.preventDefault();
							navigate(draftUrl);
						}}
					>
						<input
							value={draftUrl}
							onChange={(event) => setDraftUrl(event.target.value)}
							placeholder="localhost:3000 or https://example.com"
							className="h-8 w-full rounded-md border border-zinc-800 bg-black/30 px-3 font-mono text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
						/>
					</form>
					<button
						type="button"
						onClick={() =>
							window.open(normalizedUrl, '_blank', 'noopener,noreferrer')
						}
						disabled={!canRenderUrl}
						title="Open externally"
						className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:text-zinc-600 disabled:hover:bg-transparent"
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
						className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-white/5 hover:text-zinc-200"
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
						className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-white/5 hover:text-zinc-200"
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
						key={`${tab.id}:${tab.reloadKey}`}
						title={tab.title}
						src={normalizedUrl}
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
