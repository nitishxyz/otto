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
	ShieldCheck,
	Zap,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { SidebarHeader } from '../ui/SidebarHeader';
import { StableSpinner } from '../ui/StableSpinner';
import {
	tunnelSlotKey,
	useTunnelStore,
	type TunnelSlotState,
} from '../../stores/tunnelStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
	useStartTunnel,
	useStopTunnel,
	useTunnelStream,
	useTunnelStatus,
	type TunnelScopeArgs,
} from '../../hooks/useTunnel';
import { useProjects } from '../../hooks/useProjects';
import { getProjectId, getProjectRoot } from '../../lib/api-client/utils';
import { isShareMode } from '../../lib/share-mode';
import { openUrl } from '../../lib/open-url';
import {
	resolveProjectShareView,
	resolveRemoteControlView,
} from '../../lib/tunnel-views';
import { ProjectShareManager } from './ProjectShareManager';

const MANAGED_REMOTE_ARGS: TunnelScopeArgs = {
	scope: 'remote-control',
	mode: 'managed',
};

const QUICK_REMOTE_ARGS: TunnelScopeArgs = {
	scope: 'remote-control',
	mode: 'quick',
};

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
	// Connections are owner-only controls; never show them to share viewers.
	if (isShareMode()) return null;
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

	return (
		<div className="w-full min-w-80 border-l border-sidebar-border sidebar-fade-in flex flex-col h-full">
			<SidebarHeader
				icon={<Network className="size-[15px]" />}
				title="Connections"
				onClose={collapseSidebar}
			/>

			<div className="flex-1 overflow-y-auto">
				<RemoteControlCard />
				<ProjectShareCard
					projectId={projectId ?? null}
					projectName={projectName}
				/>
			</div>
		</div>
	);
});

interface SidebarSectionProps {
	icon: React.ReactNode;
	title: string;
	badge?: React.ReactNode;
	children: React.ReactNode;
}

/** Flat stacked sidebar section with a compact header and a divider below. */
const SidebarSection = memo(function SidebarSection({
	icon,
	title,
	badge,
	children,
}: SidebarSectionProps) {
	return (
		<section className="border-b border-border/60">
			<div className="px-3 py-2 flex items-center gap-2 bg-muted/30">
				<span className="text-muted-foreground shrink-0">{icon}</span>
				<span className="text-sm font-medium text-foreground">{title}</span>
				{badge}
			</div>
			<div className="px-3 py-2">{children}</div>
		</section>
	);
});

const RemoteControlCard = memo(function RemoteControlCard() {
	const ottorouterConnected = useTunnelStore((s) => s.ottorouterConnected);
	const managed = useTunnelStore((s) => s.remoteManaged);
	const quickStatus = useTunnelStore((s) => s.remoteQuick.status);
	const expandSettings = useSettingsStore((s) => s.expandSidebar);

	// The managed remote-control slot is the authoritative whole-machine
	// state; poll + stream it whenever the sidebar is open so enable/disable
	// from any surface (desktop Machines tab, CLI) shows up here.
	useTunnelStatus(MANAGED_REMOTE_ARGS);
	useTunnelStream(MANAGED_REMOTE_ARGS);

	const view = resolveRemoteControlView({
		managedStatus: managed.status,
		ottorouterConnected,
	});

	const pillStatus =
		view === 'ottorouter-disconnected' ? quickStatus : managed.status;

	return (
		<SidebarSection
			icon={<Globe className="size-[15px]" />}
			title="Remote Control"
			badge={<StatusPill status={pillStatus} />}
		>
			{view === 'ottorouter-disconnected' ? (
				<div className="flex flex-col gap-3">
					<div className="flex items-start gap-1.5 text-xs text-muted-foreground">
						<ShieldCheck className="w-3.5 h-3.5 shrink-0 text-primary mt-0.5" />
						<span>
							Connect OttoRouter to get a stable, managed remote-control link.
						</span>
					</div>
					<button
						type="button"
						onClick={expandSettings}
						className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
					>
						<ShieldCheck className="w-3.5 h-3.5" />
						Connect OttoRouter
					</button>
					<QuickFallback
						args={QUICK_REMOTE_ARGS}
						toggleLabel="Use a temporary quick tunnel"
						startLabel="Start quick tunnel"
						stopLabel="Turn off"
						warning="Anyone with this link can use every project on this machine. The link changes on every restart."
					/>
				</div>
			) : (
				<ManagedRemotePanel state={managed} view={view} />
			)}
		</SidebarSection>
	);
});

interface ManagedRemotePanelProps {
	state: TunnelSlotState;
	view: 'managed-live' | 'managed-starting' | 'managed-error' | 'managed-off';
}

const ManagedRemotePanel = memo(function ManagedRemotePanel({
	state,
	view,
}: ManagedRemotePanelProps) {
	const startTunnel = useStartTunnel(MANAGED_REMOTE_ARGS);
	const stopTunnel = useStopTunnel(MANAGED_REMOTE_ARGS);

	if (view === 'managed-live' && state.url) {
		return (
			<div className="flex flex-col gap-1">
				<ManagedRemoteLink
					url={state.url}
					hostname={state.hostname ?? truncateUrl(state.url)}
				/>
				<button
					type="button"
					onClick={() => stopTunnel.mutate()}
					disabled={stopTunnel.isPending}
					className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				>
					{stopTunnel.isPending && (
						<StableSpinner size="sm" title="Turning off" />
					)}
					{stopTunnel.isPending ? 'Turning off...' : 'Turn off'}
				</button>
			</div>
		);
	}

	if (view === 'managed-starting' || (view === 'managed-live' && !state.url)) {
		return (
			<div className="flex items-center gap-2 py-2">
				<StableSpinner size="sm" className="text-primary" title="Starting" />
				<span className="text-xs text-muted-foreground">
					{state.progress || 'Provisioning managed tunnel…'}
				</span>
			</div>
		);
	}

	if (view === 'managed-error') {
		return (
			<div className="flex flex-col gap-2">
				<div className="flex items-start gap-1.5 text-xs">
					<AlertCircle className="w-3.5 h-3.5 shrink-0 text-destructive mt-0.5" />
					<span className="text-muted-foreground">
						{state.error || 'Unable to start the managed tunnel.'}
					</span>
				</div>
				<button
					type="button"
					onClick={() => startTunnel.mutate()}
					disabled={startTunnel.isPending}
					className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 self-start"
				>
					Try Again
				</button>
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={() => startTunnel.mutate()}
			disabled={startTunnel.isPending}
			className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
		>
			{startTunnel.isPending && <StableSpinner size="sm" title="Starting" />}
			{startTunnel.isPending ? 'Starting...' : 'Turn on remote access'}
		</button>
	);
});

interface ManagedRemoteLinkProps {
	url: string;
	hostname: string;
}

/**
 * Compact copyable hostname row for the live managed remote-control link.
 * Owner-only semantics live in the title/aria description, not visible copy.
 */
const ManagedRemoteLink = memo(function ManagedRemoteLink({
	url,
	hostname,
}: ManagedRemoteLinkProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard may be unavailable; ignore.
		}
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
			title="Copy link — access limited to the OttoRouter account owner via the OttoCode app"
			aria-label="Copy remote control link. Access limited to the OttoRouter account owner via the OttoCode app."
		>
			<ShieldCheck className="w-3.5 h-3.5 shrink-0 text-primary" />
			<span className="flex-1 truncate font-mono text-xs text-foreground">
				{hostname}
			</span>
			{copied ? (
				<Check className="w-3.5 h-3.5 shrink-0 text-green-500" />
			) : (
				<Copy className="w-3 h-3 shrink-0 text-muted-foreground" />
			)}
		</button>
	);
});

interface ProjectShareCardProps {
	projectId: string | null;
	projectName: string | null;
}

const ProjectShareCard = memo(function ProjectShareCard({
	projectId,
	projectName,
}: ProjectShareCardProps) {
	const ottorouterConnected = useTunnelStore((s) => s.ottorouterConnected);
	const managedStatus = useTunnelStore((s) => s.remoteManaged.status);

	const view = resolveProjectShareView({
		managedStatus,
		ottorouterConnected,
	});

	const quickArgs: TunnelScopeArgs = useMemo(
		() => ({
			scope: 'project-share',
			mode: 'quick',
			projectId: projectId ?? undefined,
		}),
		[projectId],
	);

	return (
		<SidebarSection
			icon={<FolderGit2 className="size-[15px]" />}
			title="Project Share"
			badge={
				<span
					className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
					title={
						projectName
							? `Share links grant access to only "${projectName}"`
							: 'Share links grant access to only the current project'
					}
				>
					Current project
				</span>
			}
		>
			{view === 'managed-shares' ? (
				<ProjectShareManager projectId={projectId} ready />
			) : view === 'managed-shares-waiting' ? (
				<div className="flex flex-col gap-3">
					<p className="text-xs text-muted-foreground/80 leading-relaxed">
						Stable managed share links become available once Remote Control is
						on.
					</p>
					<QuickFallback
						args={quickArgs}
						disabled={!projectId}
						disabledHint="Open a project to share it."
						toggleLabel="Use a temporary quick share"
						startLabel="Share this project"
						stopLabel="Stop sharing"
					/>
				</div>
			) : (
				<QuickSharePanel
					args={quickArgs}
					disabled={!projectId}
					disabledHint="Open a project to share it."
					startLabel="Share this project"
					stopLabel="Stop sharing"
				/>
			)}
		</SidebarSection>
	);
});

interface QuickFallbackProps {
	args: TunnelScopeArgs;
	toggleLabel: string;
	startLabel: string;
	stopLabel: string;
	warning?: string;
	disabled?: boolean;
	disabledHint?: string;
}

/**
 * Collapsed entry point for the temporary quick tunnel. The quick panel (and
 * its status polling/stream) mounts only after the owner opts in, or when the
 * quick slot already has activity from this session.
 */
const QuickFallback = memo(function QuickFallback({
	args,
	toggleLabel,
	startLabel,
	stopLabel,
	warning,
	disabled,
	disabledHint,
}: QuickFallbackProps) {
	const slot = tunnelSlotKey(args.scope, args.mode);
	const slotStatus = useTunnelStore((s) => s[slot].status);
	const [opened, setOpened] = useState(false);
	const show = opened || slotStatus !== 'idle';

	if (!show) {
		return (
			<button
				type="button"
				onClick={() => setOpened(true)}
				className="flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
			>
				<Zap className="w-3.5 h-3.5" />
				{toggleLabel}
			</button>
		);
	}

	return (
		<QuickSharePanel
			args={args}
			startLabel={startLabel}
			stopLabel={stopLabel}
			warning={warning}
			disabled={disabled}
			disabledHint={disabledHint}
		/>
	);
});

interface QuickSharePanelProps {
	args: TunnelScopeArgs;
	startLabel: string;
	stopLabel: string;
	warning?: string;
	disabled?: boolean;
	disabledHint?: string;
}

/**
 * Temporary quick tunnel panel. Owns its own status polling and SSE stream so
 * the requests only run while the panel is actually visible; state lives in
 * the quick slot for its scope and never touches managed state.
 */
const QuickSharePanel = memo(function QuickSharePanel({
	args,
	startLabel,
	stopLabel,
	warning,
	disabled = false,
	disabledHint,
}: QuickSharePanelProps) {
	const slot = tunnelSlotKey(args.scope, args.mode);
	const state = useTunnelStore((s) => s[slot]);
	const startTunnel = useStartTunnel(args);
	const stopTunnel = useStopTunnel(args);

	useTunnelStatus(args);
	useTunnelStream(args);

	const isRateLimited = state.error?.includes('Rate limited');

	if (disabled) {
		return (
			<p className="text-xs text-muted-foreground/70 italic">{disabledHint}</p>
		);
	}

	if (state.status === 'connected' && state.url) {
		return (
			<div className="flex flex-col">
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
					<Zap className="w-3.5 h-3.5 shrink-0 text-yellow-500" />
					<span>Temporary link — it changes on every restart.</span>
				</div>
				<TunnelLinkDetails url={state.url} warning={warning} />
				<button
					type="button"
					onClick={() => stopTunnel.mutate()}
					disabled={stopTunnel.isPending}
					className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					{stopTunnel.isPending && <StableSpinner size="sm" title="Stopping" />}
					{stopTunnel.isPending ? 'Stopping...' : stopLabel}
				</button>
			</div>
		);
	}

	if (state.status === 'starting') {
		return (
			<div className="flex items-center gap-2 py-2">
				<StableSpinner size="sm" className="text-primary" title="Starting" />
				<span className="text-xs text-muted-foreground">
					{state.progress || 'Setting up…'}
				</span>
			</div>
		);
	}

	if (state.status === 'error') {
		return (
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
		);
	}

	return (
		<button
			type="button"
			onClick={() => startTunnel.mutate()}
			disabled={startTunnel.isPending}
			className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
		>
			{startTunnel.isPending ? (
				<StableSpinner size="sm" title="Starting" />
			) : (
				<Zap className="w-3.5 h-3.5" />
			)}
			{startTunnel.isPending ? 'Starting...' : startLabel}
		</button>
	);
});

interface TunnelLinkDetailsProps {
	url: string;
	warning?: string;
}

/** QR code, copy, and open-in-browser for a live quick tunnel. */
const TunnelLinkDetails = memo(function TunnelLinkDetails({
	url,
	warning,
}: TunnelLinkDetailsProps) {
	const [copied, setCopied] = useState(false);

	const handleCopyUrl = async () => {
		await navigator.clipboard.writeText(url);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<>
			<div className="flex justify-center pb-3">
				<div className="p-3 bg-white rounded-lg">
					<QRCodeSVG value={url} size={148} level="M" includeMargin={false} />
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
		</>
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
