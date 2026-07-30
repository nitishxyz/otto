import { Monitor, Radio, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { OttoMark, StableSpinner } from '@ottocode/web-sdk/components';
import type { MachineDeviceState } from '../lib/machine-api';
import type { OttoRouterAuthPhase } from '../lib/ottorouter-actions';
import { machinePresence, type MachinePresence } from '../lib/machine-status';
import type { TunnelDevice } from '../lib/tauri-bridge';

const PRESENCE_STYLES: Record<
	MachinePresence,
	{ label: string; dot: string; badge: string }
> = {
	checking: {
		label: 'Checking',
		dot: 'bg-amber-400/80',
		badge: 'border-border/50 text-muted-foreground',
	},
	online: {
		label: 'Online',
		dot: 'bg-emerald-500',
		badge: 'border-emerald-500/30 text-emerald-500',
	},
	offline: {
		label: 'Offline',
		dot: 'bg-muted-foreground/50',
		badge: 'border-border/50 text-muted-foreground/70',
	},
};

function PresenceBadge({ presence }: { presence: MachinePresence }) {
	const style = PRESENCE_STYLES[presence];
	return (
		<span
			className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.badge}`}
		>
			{presence === 'checking' ? (
				<StableSpinner size="xs" title="Checking machine status" />
			) : (
				<span
					className={`h-1.5 w-1.5 rounded-full ${style.dot}`}
					aria-hidden="true"
				/>
			)}
			{style.label}
		</span>
	);
}

/**
 * Machines tab panel: OttoRouter sign-in / loading / error / empty states and
 * the launchable rows for non-local account machines.
 */
export function MachineLauncher({
	state,
	loading,
	onRefresh,
	onConnect,
	onCancelConnect,
	authPhase = 'idle',
	connectError,
	onSelectMachine,
}: {
	state: MachineDeviceState | null;
	loading: boolean;
	onRefresh: () => void;
	onConnect: () => void;
	onCancelConnect?: () => void;
	/** Device-flow phase; 'pending' keeps the waiting view across refreshes. */
	authPhase?: OttoRouterAuthPhase;
	connectError?: string | null;
	onSelectMachine: (device: TunnelDevice) => Promise<void>;
}) {
	const [opening, setOpening] = useState<string | null>(null);
	const [openError, setOpenError] = useState<string | null>(null);
	const configured = state?.configured ?? false;
	const devices = configured && !state?.error ? (state?.devices ?? []) : [];
	// Blank the panel only before the first result; background refreshes keep
	// the cached rows visible while the Refresh button spins.
	const initialLoading = loading && state === null;

	const openDevice = async (device: MachineDeviceState['devices'][number]) => {
		setOpening(device.deviceId);
		setOpenError(null);
		try {
			await onSelectMachine(device);
		} catch (cause) {
			setOpenError(String(cause));
		} finally {
			setOpening(null);
		}
	};

	return (
		<div>
			{configured && (
				<div className="mb-3 flex items-center justify-between">
					<p className="text-xs text-muted-foreground/60">
						Other machines on your OttoRouter account
					</p>
					<button
						type="button"
						onClick={onRefresh}
						disabled={loading}
						className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
					>
						{loading ? (
							<StableSpinner size="sm" title="Refreshing machines" />
						) : (
							<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
						)}
						Refresh
					</button>
				</div>
			)}

			<div className="overflow-hidden rounded-xl border border-border/50 bg-card/50">
				{initialLoading && (
					<output className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground/60">
						<StableSpinner size="sm" title="Loading machines" />
						Loading machines...
					</output>
				)}
				{!initialLoading && authPhase === 'pending' && (
					<div className="px-5 py-10 text-center" aria-busy="true">
						<div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60">
							<StableSpinner title="Waiting for authorization" />
						</div>
						<output className="block text-sm text-foreground">
							Waiting for authorization...
						</output>
						<p className="mt-1 text-xs text-muted-foreground/60">
							Approve the sign-in in your browser. This screen updates
							automatically.
						</p>
						{onCancelConnect && (
							<button
								type="button"
								onClick={onCancelConnect}
								className="mt-4 h-8 px-3.5 inline-flex items-center rounded-full border border-border/50 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								Cancel
							</button>
						)}
					</div>
				)}
				{!initialLoading && authPhase !== 'pending' && !configured && (
					<div className="px-5 py-10 text-center">
						<div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60">
							<OttoMark className="h-5 w-5 text-muted-foreground" />
						</div>
						<p className="text-sm text-foreground">
							Sign in to view your machines
						</p>
						<p className="mt-1 text-xs text-muted-foreground/60">
							Connect your OttoRouter account to launch projects on your other
							devices.
						</p>
						<button
							type="button"
							onClick={onConnect}
							className="mt-4 h-8 px-3.5 inline-flex items-center gap-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors"
						>
							<Radio className="w-3.5 h-3.5" aria-hidden="true" />
							{authPhase === 'error'
								? 'Retry Connect OttoRouter'
								: 'Connect OttoRouter'}
						</button>
						{connectError && (
							<p
								role="alert"
								className="mx-auto mt-3 max-w-md text-xs text-destructive"
							>
								{connectError}
							</p>
						)}
					</div>
				)}
				{!initialLoading && configured && state?.error && (
					<div className="px-5 py-10 text-center">
						<p className="text-sm text-foreground">Machines unavailable</p>
						<p className="mt-1 text-xs text-muted-foreground/70">
							{state.error}
						</p>
						<button
							type="button"
							onClick={onRefresh}
							className="mt-4 h-8 px-3.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground rounded-lg hover:bg-muted hover:text-foreground transition-colors"
						>
							<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
							Retry
						</button>
					</div>
				)}
				{!initialLoading &&
					configured &&
					!state?.error &&
					devices.length === 0 && (
						<div className="px-4 py-10 text-center text-sm text-muted-foreground/60">
							No other machines found for this account.
						</div>
					)}
				{!initialLoading &&
					devices.map((device, index) => {
						const label = device.name || device.hostname || 'Unnamed machine';
						const presence = machinePresence(device.status);
						const offline = presence === 'offline';
						return (
							<button
								type="button"
								key={device.deviceId}
								onClick={() => openDevice(device)}
								disabled={offline || opening === device.deviceId}
								title={
									offline
										? 'Machine offline. Start otto and its managed tunnel on that machine, then refresh.'
										: undefined
								}
								className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:opacity-60 ${index > 0 ? 'border-t border-border/30' : ''}`}
							>
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
									<Monitor className="h-4 w-4 text-muted-foreground" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium text-foreground">
										{label}
									</div>
									<div className="truncate text-xs text-muted-foreground/60">
										{device.hostname || device.deviceId}
									</div>
								</div>
								<PresenceBadge presence={presence} />
								{!offline && (
									<span className="text-xs text-muted-foreground/50">
										{opening === device.deviceId ? 'Opening...' : 'Open'}
									</span>
								)}
							</button>
						);
					})}
			</div>
			{openError && (
				<p role="alert" className="mt-2 text-xs text-destructive">
					{openError}
				</p>
			)}
		</div>
	);
}
