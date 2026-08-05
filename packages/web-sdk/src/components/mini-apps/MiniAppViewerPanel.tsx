import { ExternalLink, ShieldCheck } from 'lucide-react';
import type { ViewerTab } from '../../stores/viewerTabsStore';

type MiniAppTab = Extract<ViewerTab, { type: 'mini-app' }>;

export function MiniAppViewerPanel({ tab }: { tab: MiniAppTab }) {
	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px] text-muted-foreground">
				<ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
				<span className="min-w-0 flex-1 truncate">
					Sandboxed local preview · revision {tab.revisionId}
				</span>
				<a
					href={tab.url}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 text-foreground/70 hover:text-foreground"
				>
					<ExternalLink className="h-3 w-3" />
					Open externally
				</a>
			</div>
			<iframe
				key={`${tab.url}:${tab.reloadKey}`}
				title={tab.title}
				src={tab.url}
				className="min-h-0 flex-1 border-0 bg-white"
				referrerPolicy="no-referrer"
				sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts"
			/>
		</div>
	);
}
