import { memo, useMemo, useState } from 'react';
import {
	Network,
	AlertCircle,
	AlertTriangle,
	Copy,
	Check,
	ExternalLink,
	Clock,
	Globe,
	FolderGit2,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { SidebarHeader } from '../ui/SidebarHeader';
import { StableSpinner } from '../ui/StableSpinner';
import { useTunnelStore, type TunnelScope } from '../../stores/tunnelStore';
import {
	useStartTunnel,
	useStopTunnel,
	useTunnelStream,
	useTunnelStatus,
	type TunnelScopeArgs,
} from '../../hooks/useTunnel';
import { useProjects } from '../../hooks/useProjects';
import { getProjectId, getProjectRoot } from '../../lib/api-client/utils';
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

function basename(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

export const TunnelSidebar = memo(function TunnelSidebar() {
	const isExpanded = useTunnelStore((s) => s.isExpanded);
	return isExpanded ? <TunnelSidebarContent /> : null;
});

const TunnelSidebarContent = memo(function TunnelSidebarContent() {
	const collapseSidebar = useTunnelStore((s) => s.collapseSidebar);

	const projectId = getProjectId();
	const projectRoot = getProjectRoot();
	const { data: projects } = useProjects();

	const projectName = useMemo(() => {
		if (projectId && projects) {
			const match = projects.find((p) => p.id === projectId);
			if (match?.name) return match.name;
		}
		if (projectRoot) return basename(projectRoot);
		return null;
	}, [projectId, projectRoot, projects]);

	const canShareProject = Boolean(projectId);

	return (
		<div className="w-full min-w-80 border-l border-sidebar-border sidebar-fade-in flex flex-col h-full">
			<SidebarHeader
				icon={<Network className="size-[15px]" />}
				title="Connections"
				onClose={collapseSidebar}
			/>

			<div className="flex-1 overflow-y-auto">
				<TunnelScopeSection
					scope="remote-control"
					icon={<Globe className="size-[15px]" />}
					label="Remote Control"
					description="Full access to every project on this machine. Stays on after you close otto."
					startLabel="Turn on remote access"
					stopLabel="Turn off"
					warning="Anyone with this link can use every project on this machine."
				/>

				<div className="border-t border-sidebar-border" />

				<TunnelScopeSection
					scope="project-share"
					icon={<FolderGit2 className="size-[15px]" />}
					label="Project Share"
					description={
						projectName
							? `Share only "${projectName}". Ends when you stop it.`
							: 'Share only the current project. Ends when you stop it.'
					}
					startLabel="Share this project"
					stopLabel="Stop sharing"
					disabled={!canShareProject}
					disabledHint="Open a project to share it."
				/>
			</div>
		</div>
	);
});

interface TunnelScopeSectionProps {
	scope: TunnelScope;
	icon: React.ReactNode;
	label: string;
	description: string;
	startLabel: string;
	stopLabel: string;
	warning?: string;
	disabled?: boolean;
	disabledHint?: string;
}

const TunnelScopeSection = memo(function TunnelScopeSection({
	scope,
	icon,
	label,
	description,
	startLabel,
	stopLabel,
	warning,
	disabled = false,
	disabledHint,
}: TunnelScopeSectionProps) {
	const state = useTunnelStore((s) =>
		scope === 'project-share' ? s.projectShare : s.remoteControl,
	);

	const args: TunnelScopeArgs = useMemo(() => ({ scope }), [scope]);

	useTunnelStatus(args);
	useTunnelStream(args);
	const startTunnel = useStartTunnel(args);
	const stopTunnel = useStopTunnel(args);

	const [copied, setCopied] = useState(false);

	const handleCopyUrl = async () => {
		if (state.url) {
			await navigator.clipboard.writeText(state.url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	const isRateLimited = state.error?.includes('Rate limited');

	return (
		<div className="p-4">
			<div className="flex items-center gap-2 mb-1">
				<span className="text-muted-foreground shrink-0">{icon}</span>
				<span className="text-sm font-medium text-foreground">{label}</span>
				<StatusPill status={state.status} />
			</div>
			<p className="text-xs text-muted-foreground mb-3 leading-relaxed">
				{description}
			</p>

			{disabled ? (
				<p className="text-xs text-muted-foreground/70 italic">
					{disabledHint}
				</p>
			) : state.status === 'connected' && state.url ? (
				<div className="flex flex-col">
					<div className="flex justify-center pb-3">
						<div className="p-3 bg-white rounded-lg">
							<QRCodeSVG
								value={state.url}
								size={148}
								level="M"
								includeMargin={false}
							/>
						</div>
					</div>

					<div className="flex items-center justify-between text-sm mb-3">
						<span className="text-muted-foreground">URL</span>
						<button
							type="button"
							onClick={handleCopyUrl}
							className="flex items-center gap-1.5 font-mono text-foreground hover:text-muted-foreground transition-colors"
							title="Copy URL"
						>
							{truncateUrl(state.url)}
							{copied ? (
								<Check className="w-3 h-3 text-green-500" />
							) : (
								<Copy className="w-3 h-3 text-muted-foreground" />
							)}
						</button>
					</div>

					<button
						type="button"
						onClick={() => state.url && openUrl(state.url)}
						className="flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors mb-2"
					>
						<ExternalLink className="w-3.5 h-3.5" />
						Open in browser
					</button>

					{warning && (
						<div className="flex items-start gap-1.5 text-xs text-muted-foreground mb-2">
							<AlertTriangle className="w-3.5 h-3.5 shrink-0 text-yellow-500 mt-0.5" />
							<span>{warning}</span>
						</div>
					)}

					<button
						type="button"
						onClick={() => stopTunnel.mutate()}
						disabled={stopTunnel.isPending}
						className="w-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
					>
						{stopTunnel.isPending ? 'Stopping...' : stopLabel}
					</button>
				</div>
			) : state.status === 'starting' ? (
				<div className="flex items-center gap-2 py-2">
					<StableSpinner size="sm" className="text-primary" title="Starting" />
					<span className="text-xs text-muted-foreground">
						{state.progress || 'Setting up...'}
					</span>
				</div>
			) : state.status === 'error' ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-start gap-1.5 text-xs">
						{isRateLimited ? (
							<Clock className="w-3.5 h-3.5 shrink-0 text-yellow-500 mt-0.5" />
						) : (
							<AlertCircle className="w-3.5 h-3.5 shrink-0 text-destructive mt-0.5" />
						)}
						<span className="text-muted-foreground">
							{isRateLimited
								? 'Cloudflare rate limited anonymous tunnels. Wait 5-10 minutes.'
								: state.error || 'Unable to establish tunnel connection.'}
						</span>
					</div>
					<button
						type="button"
						onClick={() => startTunnel.mutate()}
						disabled={startTunnel.isPending || isRateLimited}
						className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 self-start"
						title={isRateLimited ? 'Wait 5-10 minutes' : undefined}
					>
						{isRateLimited ? 'Wait & Try Again' : 'Try Again'}
					</button>
				</div>
			) : (
				<button
					type="button"
					onClick={() => startTunnel.mutate()}
					disabled={startTunnel.isPending}
					className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
				>
					{startTunnel.isPending ? 'Starting...' : startLabel}
				</button>
			)}
		</div>
	);
});

function StatusPill({ status }: { status: string }) {
	if (status === 'connected') {
		return (
			<span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-green-600">
				<span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
				Active
			</span>
		);
	}
	if (status === 'starting') {
		return (
			<span className="ml-auto text-xs font-medium text-muted-foreground">
				Starting…
			</span>
		);
	}
	if (status === 'error') {
		return (
			<span className="ml-auto text-xs font-medium text-destructive">
				Error
			</span>
		);
	}
	return (
		<span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
			<span className="w-2 h-2 rounded-full border border-muted-foreground/40" />
			Off
		</span>
	);
}
