import { AlertTriangle, ArrowUpCircle, MonitorDown } from 'lucide-react';
import { StableSpinner } from '@ottocode/web-sdk/components';
import { useUpdate } from '../hooks/useUpdate';

export type RemoteUpgradePhase =
	| { phase: 'idle' }
	| { phase: 'staging'; targetVersion: string }
	| { phase: 'staged'; targetVersion: string }
	| { phase: 'error'; targetVersion: string; message: string };

/** Non-blocking notice for legacy/limited hosts that still allow fallback use. */
export function RemoteLimitedNotice({ reason }: { reason: string }) {
	return (
		<div className="mb-3 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
			<AlertTriangle
				className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
				aria-hidden="true"
			/>
			<p className="text-xs leading-relaxed text-muted-foreground">
				<span className="font-medium text-foreground">
					Limited compatibility.
				</span>{' '}
				{reason}
			</p>
		</div>
	);
}

/**
 * Blocking panel for hosts older than this client supports. Offers the
 * explicit staged-upgrade action only when the host advertises
 * `remote.upgrade.stage` and a strictly newer official release is known;
 * otherwise shows exact host-side update guidance. Staging never replaces or
 * restarts the remote daemon: activation is an owner-managed host restart.
 */
export function RemoteHostTooOldPanel({
	machineName,
	hostVersion,
	upgradeTarget,
	guidance,
	upgrade,
	onStageUpgrade,
	onRecheck,
	rechecking,
}: {
	machineName: string;
	hostVersion: string | null;
	upgradeTarget: string | null;
	guidance: string;
	upgrade: RemoteUpgradePhase;
	onStageUpgrade: (targetVersion: string) => void;
	onRecheck: () => void;
	rechecking: boolean;
}) {
	return (
		<div className="px-6 py-10 text-center">
			<ArrowUpCircle className="mx-auto h-6 w-6 text-muted-foreground" />
			<p className="mt-3 text-sm font-medium text-foreground">
				This machine needs an update
			</p>
			<p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
				{machineName} is running otto{' '}
				{hostVersion ? `v${hostVersion}` : '(unknown version)'}, which is too
				old for this desktop app. Opening projects is disabled until the machine
				is updated.
			</p>

			{upgrade.phase === 'staged' ? (
				<div className="mx-auto mt-5 max-w-md">
					<p className="text-xs leading-relaxed text-foreground">
						Upgrade v{upgrade.targetVersion} is staged on {machineName}. It has
						not been applied: restart the otto daemon on that machine to
						activate it.
					</p>
					<output className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
						<StableSpinner size="xs" title="Waiting for the machine" />
						Watching for the machine to come back...
					</output>
					<button
						type="button"
						onClick={onRecheck}
						disabled={rechecking}
						className="mt-3 h-8 px-3.5 inline-flex items-center rounded-full border border-border/50 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
					>
						Check now
					</button>
				</div>
			) : upgradeTarget ? (
				<div className="mx-auto mt-5 max-w-md">
					<button
						type="button"
						onClick={() => onStageUpgrade(upgradeTarget)}
						disabled={upgrade.phase === 'staging'}
						className="h-8 px-3.5 inline-flex items-center gap-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors disabled:opacity-60"
					>
						{upgrade.phase === 'staging' ? (
							<>
								<StableSpinner size="xs" title="Staging upgrade" />
								Staging upgrade...
							</>
						) : (
							<>Stage upgrade to v{upgradeTarget}</>
						)}
					</button>
					<p className="mt-3 text-xs leading-relaxed text-muted-foreground">
						This stages the official v{upgradeTarget} release on {machineName}.
						The running daemon is not replaced or restarted; you must restart
						otto on that machine to activate the upgrade.
					</p>
					{upgrade.phase === 'error' && (
						<p role="alert" className="mt-2 text-xs text-destructive">
							{upgrade.message}
						</p>
					)}
				</div>
			) : (
				<p className="mx-auto mt-5 max-w-md text-xs leading-relaxed text-foreground">
					{guidance}
				</p>
			)}
		</div>
	);
}

/**
 * Blocking panel when the remote host requires a newer client. Wires the
 * existing Tauri updater so the user can update this desktop app in place.
 */
export function RemoteClientTooOldPanel({
	machineName,
	hostVersion,
}: {
	machineName: string;
	hostVersion: string | null;
}) {
	const {
		available,
		version,
		downloading,
		downloaded,
		progress,
		error,
		downloadUpdate,
		applyUpdate,
		checkForUpdate,
	} = useUpdate();

	return (
		<div className="px-6 py-10 text-center">
			<MonitorDown className="mx-auto h-6 w-6 text-muted-foreground" />
			<p className="mt-3 text-sm font-medium text-foreground">
				Update this app to continue
			</p>
			<p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
				{machineName} is running a newer otto daemon
				{hostVersion ? ` (v${hostVersion})` : ''} than this desktop app
				supports. Opening projects is disabled until the app is updated.
			</p>
			<div className="mx-auto mt-5 max-w-md">
				{downloaded ? (
					<button
						type="button"
						onClick={() => void applyUpdate()}
						className="h-8 px-3.5 inline-flex items-center text-sm font-medium bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors"
					>
						Restart to update
					</button>
				) : downloading ? (
					<output className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
						<StableSpinner size="xs" title="Downloading update" />
						Downloading update... {progress}%
					</output>
				) : available ? (
					<button
						type="button"
						onClick={() => void downloadUpdate()}
						className="h-8 px-3.5 inline-flex items-center text-sm font-medium bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors"
					>
						Download update{version ? ` v${version}` : ''}
					</button>
				) : (
					<button
						type="button"
						onClick={() => void checkForUpdate()}
						className="h-8 px-3.5 inline-flex items-center rounded-full border border-border/50 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						Check for updates
					</button>
				)}
				{error && (
					<p role="alert" className="mt-2 text-xs text-destructive">
						{error}
					</p>
				)}
			</div>
		</div>
	);
}
