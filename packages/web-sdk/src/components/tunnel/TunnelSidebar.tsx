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
	useTunnelStore,
	type TunnelMode,
	type TunnelScope,
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
import { ProjectShareManager } from './ProjectShareManager';

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
				<RemoteControlSection />

				<div className="border-t border-sidebar-border" />

				<ProjectShareSection
					projectId={projectId ?? null}
					projectName={projectName}
				/>
			</div>
		</div>
	);
});

const REMOTE_ARGS: Record<TunnelMode, TunnelScopeArgs> = {
	managed: { scope: 'remote-control', mode: 'managed' },
	quick: { scope: 'remote-control', mode: 'quick' },
};

const RemoteControlSection = memo(function RemoteControlSection() {
	const ottorouterConnected = useTunnelStore((s) => s.ottorouterConnected);
	const managed = useTunnelStore((s) => s.remoteControl);
	const expandSettings = useSettingsStore((s) => s.expandSidebar);

	// Poll status for both modes so ottorouterConnected + managed hostname stay
	// current regardless of which mode the owner is using.
	useTunnelStatus(REMOTE_ARGS.managed);
	useTunnelStatus(REMOTE_ARGS.quick);
	useTunnelStream(
		managed.mode === 'managed' ? REMOTE_ARGS.managed : REMOTE_ARGS.quick,
	);

	const [showQuick, setShowQuick] = useState(false);

	const managedActive =
		managed.mode === 'managed' &&
		(managed.status === 'connected' ||
			managed.status === 'starting' ||
			managed.status === 'error');

	return (
		<div className="p-4">
			<div className="flex items-center gap-2 mb-1">
				<span className="text-muted-foreground shrink-0">
					<Globe className="size-[15px]" />
				</span>
				<span className="text-sm font-medium text-foreground">
					Remote Control
				</span>
				<StatusPill status={managedActive ? managed.status : 'idle'} />
			</div>
			<p className="text-xs text-muted-foreground mb-3 leading-relaxed">
				Full access to every project on this machine. Stays on after you close
				otto.
			</p>

			{ottorouterConnected || managedActive ? (
				<ManagedTunnelPanel
					state={managed}
					warning="Anyone with this link can use every project on this machine."
				/>
			) : (
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

					{showQuick ? (
						<QuickTunnelPanel
							args={REMOTE_ARGS.quick}
							startLabel="Start quick tunnel"
							stopLabel="Turn off"
							warning="Anyone with this link can use every project on this machine."
						/>
					) : (
						<button
							type="button"
							onClick={() => setShowQuick(true)}
							className="flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
						>
							<Zap className="w-3.5 h-3.5" />
							Use a quick tunnel instead
						</button>
					)}
				</div>
			)}
		</div>
	);
});

interface ProjectShareSectionProps {
	projectId: string | null;
	projectName: string | null;
}

const ProjectShareSection = memo(function ProjectShareSection({
	projectId,
	projectName,
}: ProjectShareSectionProps) {
	const ottorouterConnected = useTunnelStore((s) => s.ottorouterConnected);
	const remoteConnected = useTunnelStore(
		(s) =>
			s.remoteControl.mode === 'managed' &&
			s.remoteControl.status === 'connected',
	);

	const quickArgs: TunnelScopeArgs = useMemo(
		() => ({
			scope: 'project-share',
			mode: 'quick',
			projectId: projectId ?? undefined,
		}),
		[projectId],
	);

	// Keep quick project-share status/stream live so the QR + URL stay current
	// when the owner uses the quick fallback path.
	useTunnelStatus(quickArgs);
	useTunnelStream(quickArgs);

	const [useQuick, setUseQuick] = useState(false);
	const managedSharesAvailable = ottorouterConnected;

	return (
		<div className="p-4">
			<div className="flex items-center gap-2 mb-1">
				<span className="text-muted-foreground shrink-0">
					<FolderGit2 className="size-[15px]" />
				</span>
				<span className="text-sm font-medium text-foreground">
					Project Share
				</span>
			</div>
			<p className="text-xs text-muted-foreground mb-3 leading-relaxed">
				{projectName
					? `Share only "${projectName}".`
					: 'Share only the current project.'}
			</p>

			{managedSharesAvailable && !useQuick ? (
				<div className="flex flex-col gap-3">
					<ProjectShareManager
						projectId={projectId}
						projectName={projectName}
						ready={remoteConnected}
					/>
					<button
						type="button"
						onClick={() => setUseQuick(true)}
						className="flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
					>
						<Zap className="w-3.5 h-3.5" />
						Use a quick share instead
					</button>
				</div>
			) : (
				<QuickTunnelPanel
					args={quickArgs}
					scope="project-share"
					disabled={!projectId}
					disabledHint="Open a project to share it."
					startLabel="Share this project"
					stopLabel="Stop sharing"
				/>
			)}
		</div>
	);
});

interface ManagedTunnelPanelProps {
	state: {
		status: string;
		url: string | null;
		error: string | null;
		progress: string | null;
		hostname: string | null;
	};
	warning?: string;
}

const ManagedTunnelPanel = memo(function ManagedTunnelPanel({
	state,
	warning,
}: ManagedTunnelPanelProps) {
	const startTunnel = useStartTunnel(REMOTE_ARGS.managed);
	const stopTunnel = useStopTunnel(REMOTE_ARGS.managed);
	const [copied, setCopied] = useState(false);

	const handleCopyUrl = async () => {
		if (state.url) {
			await navigator.clipboard.writeText(state.url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	if (state.status === 'connected' && state.url) {
		return (
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

				{state.hostname && (
					<div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
						<ShieldCheck className="w-3.5 h-3.5 shrink-0 text-primary" />
						<span className="font-mono truncate">{state.hostname}</span>
						<span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
							Stable
						</span>
					</div>
				)}

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
					{stopTunnel.isPending ? 'Stopping...' : 'Turn off'}
				</button>
			</div>
		);
	}

	if (state.status === 'starting') {
		return (
			<div className="flex items-center gap-2 py-2">
				<StableSpinner size="sm" className="text-primary" title="Starting" />
				<span className="text-xs text-muted-foreground">
					{state.progress || 'Provisioning managed tunnel…'}
				</span>
			</div>
		);
	}

	if (state.status === 'error') {
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
			className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
		>
			{startTunnel.isPending ? 'Starting...' : 'Turn on remote access'}
		</button>
	);
});

interface QuickTunnelPanelProps {
	args: TunnelScopeArgs;
	scope?: TunnelScope;
	startLabel: string;
	stopLabel: string;
	warning?: string;
	disabled?: boolean;
	disabledHint?: string;
}

const QuickTunnelPanel = memo(function QuickTunnelPanel({
	args,
	scope = 'remote-control',
	startLabel,
	stopLabel,
	warning,
	disabled = false,
	disabledHint,
}: QuickTunnelPanelProps) {
	const state = useTunnelStore((s) =>
		scope === 'project-share' ? s.projectShare : s.remoteControl,
	);
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

	if (disabled) {
		return (
			<p className="text-xs text-muted-foreground/70 italic">{disabledHint}</p>
		);
	}

	if (state.status === 'connected' && state.url) {
		return (
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
			className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
		>
			{startTunnel.isPending ? 'Starting...' : startLabel}
		</button>
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
