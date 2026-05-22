import { memo, useState } from 'react';
import {
	Globe,
	AlertCircle,
	Copy,
	Check,
	ExternalLink,
	Clock,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { SidebarHeader } from '../ui/SidebarHeader';
import { StableSpinner } from '../ui/StableSpinner';
import { useTunnelStore } from '../../stores/tunnelStore';
import {
	useStartTunnel,
	useStopTunnel,
	useTunnelStream,
	useTunnelStatus,
} from '../../hooks/useTunnel';
import { openUrl } from '../../lib/open-url';

function truncateUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname;
		if (host.length > 24) {
			return `${host.slice(0, 12)}...${host.slice(-8)}`;
		}
		return host;
	} catch {
		return url.length > 24 ? `${url.slice(0, 12)}...${url.slice(-8)}` : url;
	}
}

export const TunnelSidebar = memo(function TunnelSidebar() {
	const isExpanded = useTunnelStore((s) => s.isExpanded);
	const collapseSidebar = useTunnelStore((s) => s.collapseSidebar);
	const status = useTunnelStore((s) => s.status);
	const url = useTunnelStore((s) => s.url);
	const error = useTunnelStore((s) => s.error);
	const progress = useTunnelStore((s) => s.progress);

	const startTunnel = useStartTunnel();
	const stopTunnel = useStopTunnel();
	const [copied, setCopied] = useState(false);

	useTunnelStatus();
	useTunnelStream();

	const handleCopyUrl = async () => {
		if (url) {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	const handleStart = () => {
		startTunnel.mutate();
	};

	const handleStop = () => {
		stopTunnel.mutate();
	};

	if (!isExpanded) return null;

	return (
		<div className="w-full min-w-80 border-l border-sidebar-border sidebar-fade-in flex flex-col h-full">
			<SidebarHeader
				icon={<Globe className="size-[15px]" />}
				title="Remote Access"
				onClose={collapseSidebar}
			/>

			<div className="flex-1 overflow-y-auto p-4">
				{status === 'idle' && (
					<div className="flex flex-col items-center justify-center h-full text-center">
						<Globe className="w-12 h-12 text-muted-foreground/30 mb-4" />
						<h3 className="text-sm font-medium mb-2">Access from anywhere</h3>
						<p className="text-xs text-muted-foreground mb-6 max-w-[200px]">
							Start a secure tunnel to access otto from your phone or another
							device.
						</p>
						<button
							type="button"
							onClick={handleStart}
							disabled={startTunnel.isPending}
							className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
						>
							{startTunnel.isPending ? 'Starting...' : 'Start Tunnel'}
						</button>
					</div>
				)}

				{status === 'starting' && (
					<div className="flex flex-col items-center justify-center h-full text-center">
						<StableSpinner
							size="xl"
							className="mb-4 text-primary"
							title="Starting tunnel"
						/>
						<h3 className="text-sm font-medium mb-2">Setting up...</h3>
						{progress && (
							<p className="text-xs text-muted-foreground max-w-[220px] break-words">
								{progress}
							</p>
						)}
					</div>
				)}

				{status === 'connected' && url && (
					<div className="flex flex-col">
						<div className="flex items-center gap-2 mb-4">
							<div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
							<span className="text-xs font-medium text-green-600">
								Connected
							</span>
						</div>

						<div className="flex justify-center pb-4">
							<div className="p-3 bg-white rounded-lg">
								<QRCodeSVG
									value={url}
									size={160}
									level="M"
									includeMargin={false}
								/>
							</div>
						</div>

						<p className="text-xs text-muted-foreground mb-4 text-center">
							Scan with your phone camera
						</p>

						<div className="flex items-center justify-between text-sm mb-4">
							<span className="text-muted-foreground">URL</span>
							<button
								type="button"
								onClick={handleCopyUrl}
								className="flex items-center gap-1.5 font-mono text-foreground hover:text-muted-foreground transition-colors"
								title="Copy URL"
							>
								{truncateUrl(url)}
								{copied ? (
									<Check className="w-3 h-3 text-green-500" />
								) : (
									<Copy className="w-3 h-3 text-muted-foreground" />
								)}
							</button>
						</div>

						<button
							type="button"
							onClick={() => openUrl(url)}
							className="flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors mb-3"
						>
							<ExternalLink className="w-3.5 h-3.5" />
							Open in browser
						</button>

						<button
							type="button"
							onClick={handleStop}
							disabled={stopTunnel.isPending}
							className="w-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
						>
							{stopTunnel.isPending ? 'Stopping...' : 'Stop Tunnel'}
						</button>
					</div>
				)}

				{status === 'error' && (
					<div className="flex flex-col items-center justify-center h-full text-center">
						{error?.includes('Rate limited') ? (
							<>
								<Clock className="w-8 h-8 text-yellow-500 mb-4" />
								<h3 className="text-sm font-medium mb-2">Rate Limited</h3>
								<p className="text-xs text-muted-foreground mb-6 max-w-[220px]">
									Cloudflare limits anonymous tunnel requests. Please wait 5-10
									minutes before trying again.
								</p>
							</>
						) : (
							<>
								<AlertCircle className="w-8 h-8 text-destructive mb-4" />
								<h3 className="text-sm font-medium mb-2">Connection failed</h3>
								<p className="text-xs text-muted-foreground mb-6 max-w-[200px]">
									{error || 'Unable to establish tunnel connection.'}
								</p>
							</>
						)}
						<button
							type="button"
							onClick={handleStart}
							disabled={
								startTunnel.isPending || error?.includes('Rate limited')
							}
							className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
							title={
								error?.includes('Rate limited')
									? 'Wait 5-10 minutes'
									: undefined
							}
						>
							{error?.includes('Rate limited')
								? 'Wait & Try Again'
								: 'Try Again'}
						</button>
					</div>
				)}
			</div>
		</div>
	);
});
