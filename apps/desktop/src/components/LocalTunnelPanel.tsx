import { Check, Copy, ExternalLink, Laptop, Radio } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useManagedTunnel } from '../hooks/useManagedTunnel';
import { usePlatform } from '../hooks/usePlatform';
import type { ManagedTunnelState } from '../lib/managed-tunnel-store';

const STATE_STYLES: Record<
	ManagedTunnelState,
	{ label: string; dot: string; badge: string }
> = {
	off: {
		label: 'Off',
		dot: 'bg-muted-foreground/50',
		badge: 'border-border/50 text-muted-foreground/70',
	},
	starting: {
		label: 'Starting',
		dot: 'bg-amber-400/80',
		badge: 'border-border/50 text-muted-foreground',
	},
	online: {
		label: 'Online',
		dot: 'bg-emerald-500',
		badge: 'border-emerald-500/30 text-emerald-500',
	},
	error: {
		label: 'Error',
		dot: 'bg-destructive',
		badge: 'border-destructive/30 text-destructive',
	},
};

function TunnelStateBadge({
	state,
	checking,
}: {
	state: ManagedTunnelState;
	checking: boolean;
}) {
	const style = checking
		? {
				label: 'Checking',
				dot: 'bg-amber-400/80',
				badge: 'border-border/50 text-muted-foreground',
			}
		: STATE_STYLES[state];
	return (
		<output
			className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.badge}`}
		>
			<span
				className={`h-1.5 w-1.5 rounded-full ${style.dot} ${
					checking || state === 'starting' ? 'animate-pulse' : ''
				}`}
				aria-hidden="true"
			/>
			{style.label}
		</output>
	);
}

/**
 * Local machine panel above the remote machine list: daemon identity,
 * managed remote-control tunnel state, hostname copy/open affordances, and
 * a theme-consistent Enable/Disable control. Requires an OttoRouter
 * connection before enabling (shared Connect flow); no quick-mode fallback.
 */
export function LocalTunnelPanel({
	ottorouterConfigured,
	onConnect,
	connectBusy,
}: {
	ottorouterConfigured: boolean;
	onConnect: () => void;
	connectBusy: boolean;
}) {
	const tunnel = useManagedTunnel();
	const platform = usePlatform();
	const [copied, setCopied] = useState(false);
	const copyResetRef = useRef<number | null>(null);

	useEffect(
		() => () => {
			if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
		},
		[],
	);

	const status = tunnel.status;
	const checking = status === null;
	const state = status?.state ?? 'off';
	const hostname = status?.hostname ?? null;
	const openableUrl = status?.url ?? (hostname ? `https://${hostname}` : null);
	const busy = tunnel.pending !== null;
	const enabled = state === 'online' || state === 'starting';
	const localName = platform === 'macos' ? 'This Mac' : 'This device';

	const copyHostname = async () => {
		if (!hostname) return;
		try {
			await navigator.clipboard.writeText(hostname);
			setCopied(true);
			if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
			copyResetRef.current = window.setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard denied; the hostname stays visible for manual selection.
		}
	};

	return (
		<section
			aria-label="This machine"
			className="mb-4 overflow-hidden rounded-xl border border-border/50 bg-card/50"
		>
			<div className="flex flex-wrap items-center gap-3 px-4 py-3">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
					<Laptop className="h-4 w-4 text-muted-foreground" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate text-sm font-medium text-foreground">
							{localName}
						</span>
						<TunnelStateBadge state={state} checking={checking} />
					</div>
					<div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground/60">
						{hostname ? (
							<>
								<span className="truncate font-mono">{hostname}</span>
								<button
									type="button"
									onClick={copyHostname}
									className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
									title="Copy hostname"
									aria-label="Copy tunnel hostname"
								>
									{copied ? (
										<Check className="h-3 w-3 text-emerald-500" />
									) : (
										<Copy className="h-3 w-3" />
									)}
								</button>
								{openableUrl && (
									<button
										type="button"
										onClick={() => void openUrl(openableUrl)}
										className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
										title="Open in browser"
										aria-label="Open tunnel URL in browser"
									>
										<ExternalLink className="h-3 w-3" />
									</button>
								)}
							</>
						) : (
							<span className="truncate">
								Local daemon, remote access {enabled ? 'starting' : 'disabled'}
							</span>
						)}
					</div>
				</div>
				{ottorouterConfigured ? (
					<button
						type="button"
						onClick={() => void (enabled ? tunnel.disable() : tunnel.enable())}
						disabled={busy || checking}
						aria-busy={busy}
						className={`h-8 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors disabled:opacity-60 ${
							enabled
								? 'border border-border/50 text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive'
								: 'bg-primary text-primary-foreground hover:bg-primary/90'
						}`}
					>
						{busy
							? tunnel.pending === 'disable'
								? 'Disabling...'
								: 'Enabling...'
							: enabled
								? 'Disable'
								: 'Enable'}
					</button>
				) : (
					<button
						type="button"
						onClick={onConnect}
						disabled={connectBusy}
						className="h-8 shrink-0 inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
						title="OttoRouter connection is required for remote access"
					>
						<Radio className="h-3.5 w-3.5" aria-hidden="true" />
						{connectBusy ? 'Connecting...' : 'Connect OttoRouter'}
					</button>
				)}
			</div>
			{!ottorouterConfigured && (
				<p className="border-t border-border/30 px-4 py-2 text-xs text-muted-foreground/60">
					Remote access needs your OttoRouter account before this machine can be
					reached from other devices.
				</p>
			)}
			{(tunnel.actionError || (state === 'error' && status?.error)) && (
				<p
					role="alert"
					className="border-t border-destructive/20 px-4 py-2 text-xs text-destructive"
				>
					{tunnel.actionError ?? status?.error}
				</p>
			)}
		</section>
	);
}
