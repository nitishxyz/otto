import { useNavigate } from '@tanstack/react-router';
import { StableSpinner, TitleBar } from '@ottocode/web-sdk/components';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
	CheckCircle2,
	Download,
	Monitor,
	Power,
	RefreshCw,
	RotateCw,
	TerminalSquare,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useFullscreen } from '../hooks/useFullscreen';
import { usePlatform } from '../hooks/usePlatform';
import {
	loadAuthorizedMachineProjects,
	restartRemoteHost,
	stageRemoteHostUpgrade,
} from '../lib/machine-api';
import {
	isStrictlyNewerRelease,
	REMOTE_RESTART_CAPABILITY,
	REMOTE_UPGRADE_CAPABILITY,
} from '../lib/remote-compatibility';
import type {
	MachineBootstrap,
	MachineProjectAccess,
} from '../lib/tauri-bridge';
import { tauriBridge } from '../lib/tauri-bridge';
import { handleTitleBarDrag } from '../utils/title-bar';
import { OttoWordmark } from './Icons';
import type { RemoteUpgradePhase } from './RemoteCompatibilityPanel';
import { WindowControls } from './WindowControls';

type ReadyAccess = Extract<MachineProjectAccess, { status: 'ready' }>;
type RestartPhase =
	| { phase: 'idle' }
	| {
			phase: 'reconnecting';
			previousStartedAt: number | undefined;
			targetVersion?: string;
	  }
	| { phase: 'complete'; targetVersion?: string }
	| { phase: 'error'; message: string };

function describeError(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/** Owner-only status and update controls for the currently connected machine. */
export function RemoteMachineSettings({
	machine,
	localDaemonUrl,
}: {
	machine: MachineBootstrap;
	localDaemonUrl: string;
}) {
	const navigate = useNavigate();
	const platform = usePlatform();
	const isFullscreen = useFullscreen();
	const runtimeHeadingId = useId();
	const updatesHeadingId = useId();
	const [access, setAccess] = useState<MachineProjectAccess | null>(null);
	const [clientRelease, setClientRelease] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [upgrade, setUpgrade] = useState<RemoteUpgradePhase>({
		phase: 'idle',
	});
	const [restart, setRestart] = useState<RestartPhase>({ phase: 'idle' });
	const machineName = machine.name || machine.hostname || 'Otto machine';

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [nextAccess, selection] = await Promise.all([
				loadAuthorizedMachineProjects(machine, localDaemonUrl, true),
				tauriBridge.getCliSelection().catch(() => null),
			]);
			setAccess(nextAccess);
			if (selection) setClientRelease(selection.version || null);
		} catch (cause) {
			setError(describeError(cause));
		} finally {
			setLoading(false);
		}
	}, [localDaemonUrl, machine]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const ready: ReadyAccess | null = access?.status === 'ready' ? access : null;
	const hostVersion = ready?.serverInfo?.version ?? null;
	const updateTarget = useMemo(
		() =>
			isStrictlyNewerRelease(hostVersion, clientRelease) ? clientRelease : null,
		[clientRelease, hostVersion],
	);
	const hostIsNewer = isStrictlyNewerRelease(clientRelease, hostVersion);
	const versionsMatch =
		hostVersion !== null &&
		clientRelease !== null &&
		hostVersion === clientRelease;
	const versionsComparable =
		updateTarget !== null || hostIsNewer || versionsMatch;
	const canStageUpdate =
		updateTarget !== null &&
		(ready?.serverInfo?.protocol?.capabilities?.includes(
			REMOTE_UPGRADE_CAPABILITY,
		) ??
			false);
	const canRestart =
		ready?.serverInfo?.protocol?.capabilities?.includes(
			REMOTE_RESTART_CAPABILITY,
		) ?? false;
	const canUpdate = canStageUpdate && canRestart;

	const updateDaemon = useCallback(async () => {
		if (
			!ready ||
			!updateTarget ||
			!canUpdate ||
			upgrade.phase === 'staging' ||
			restart.phase === 'reconnecting'
		)
			return;
		const confirmed = await confirm(
			`Update the Otto CLI on ${machineName} to v${updateTarget} and restart its service? Active sessions will reconnect after the daemon and tunnel return.`,
			{ title: 'Update Otto CLI' },
		);
		if (!confirmed) return;
		setUpgrade({ phase: 'staging', targetVersion: updateTarget });
		try {
			await stageRemoteHostUpgrade(
				ready.apiUrl,
				ready.ownerSession,
				updateTarget,
			);
		} catch (cause) {
			setUpgrade({
				phase: 'error',
				targetVersion: updateTarget,
				message: describeError(cause),
			});
			return;
		}
		setUpgrade({ phase: 'staged', targetVersion: updateTarget });
		setRestart({
			phase: 'reconnecting',
			previousStartedAt: ready.serverInfo?.startedAt,
			targetVersion: updateTarget,
		});
		try {
			await restartRemoteHost(ready, updateTarget);
		} catch (cause) {
			setRestart({ phase: 'error', message: describeError(cause) });
		}
	}, [
		canUpdate,
		machineName,
		ready,
		restart.phase,
		updateTarget,
		upgrade.phase,
	]);

	const restartDaemon = useCallback(async () => {
		if (!ready || !canRestart || restart.phase === 'reconnecting') return;
		const targetVersion =
			upgrade.phase === 'staged' ? upgrade.targetVersion : undefined;
		const confirmed = await confirm(
			targetVersion
				? `Restart Otto on ${machineName} and activate v${targetVersion}? Active sessions will reconnect after the daemon and tunnel return.`
				: `Restart Otto on ${machineName}? Active sessions will reconnect after the daemon and tunnel return.`,
			{ title: targetVersion ? 'Restart and update' : 'Restart daemon' },
		);
		if (!confirmed) return;
		setRestart({
			phase: 'reconnecting',
			previousStartedAt: ready.serverInfo?.startedAt,
			targetVersion,
		});
		try {
			await restartRemoteHost(ready, targetVersion);
		} catch (cause) {
			setRestart({ phase: 'error', message: describeError(cause) });
		}
	}, [canRestart, machineName, ready, restart.phase, upgrade]);

	useEffect(() => {
		if (restart.phase !== 'reconnecting') return;
		let cancelled = false;
		const check = () => {
			void loadAuthorizedMachineProjects(machine, localDaemonUrl, true)
				.then((next) => {
					if (cancelled) return;
					setAccess(next);
					if (next.status !== 'ready') return;
					const restarted =
						restart.targetVersion !== undefined
							? next.serverInfo?.version === restart.targetVersion
							: next.serverInfo?.startedAt !== undefined &&
								next.serverInfo.startedAt !== restart.previousStartedAt;
					if (restarted) {
						setRestart({
							phase: 'complete',
							targetVersion: restart.targetVersion,
						});
						setUpgrade({ phase: 'idle' });
					}
				})
				.catch(() => {});
		};
		const interval = window.setInterval(check, 3000);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [localDaemonUrl, machine, restart]);

	const statusMessage = access
		? access.status === 'ready'
			? 'Connected'
			: access.message
		: 'Checking connection...';

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
			<TitleBar
				onMouseDown={handleTitleBarDrag}
				dragRegion
				leadingInset={platform === 'macos' && !isFullscreen}
				onBack={() => void navigate({ to: '/projects' })}
				showSidebarToggle={false}
				title={<OttoWordmark height={16} className="text-foreground" />}
				trailing={platform === 'linux' ? <WindowControls /> : undefined}
			/>

			<main className="flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-3xl px-6 py-12">
					<div className="mb-10">
						<p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
							Remote machine
						</p>
						<h1 className="mt-2 text-3xl font-semibold tracking-tight">
							{machineName}
						</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							Inspect this machine and manage its Otto daemon.
						</p>
					</div>

					{error && (
						<p
							role="alert"
							className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive"
						>
							{error}
						</p>
					)}

					<section className="mb-8" aria-labelledby={runtimeHeadingId}>
						<div className="mb-3 flex items-center gap-2">
							<Power className="h-4 w-4 text-muted-foreground" />
							<h2 id={runtimeHeadingId} className="text-sm font-semibold">
								Remote daemon
							</h2>
						</div>
						<div className="rounded-xl border border-border/50 bg-card/40">
							<div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/50">
									<Monitor className="h-4 w-4 text-muted-foreground" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span
											className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
										/>
										<p className="text-sm font-medium">{statusMessage}</p>
									</div>
									<p className="mt-1.5 truncate text-xs text-muted-foreground">
										{machine.hostname ?? 'No tunnel hostname'}
										{hostVersion ? ` · Otto v${hostVersion}` : ''}
									</p>
								</div>
								<button
									type="button"
									onClick={() => void refresh()}
									disabled={loading}
									className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
								>
									{loading ? (
										<StableSpinner size="sm" title="Checking machine" />
									) : (
										<RefreshCw className="h-3.5 w-3.5" />
									)}
									Check status
								</button>
							</div>
							<div className="flex flex-col gap-3 border-t border-border/40 px-5 py-4 sm:flex-row sm:items-center">
								<TerminalSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
								<div className="min-w-0 flex-1">
									<p className="text-xs font-medium">
										{canRestart ? 'Managed restart' : 'Restart on the machine'}
									</p>
									<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
										{canRestart ? (
											'Restarts the daemon and managed tunnel with a supervised process handoff.'
										) : (
											<>
												This daemon cannot guarantee a remote handoff. On{' '}
												{machineName}, run{' '}
												<code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
													otto service restart
												</code>
												.
											</>
										)}
									</p>
								</div>
								{canRestart && (
									<button
										type="button"
										onClick={() => void restartDaemon()}
										disabled={restart.phase === 'reconnecting'}
										className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
									>
										{restart.phase === 'reconnecting' ? (
											<StableSpinner size="sm" title="Restarting daemon" />
										) : (
											<RotateCw className="h-3.5 w-3.5" />
										)}
										{restart.phase === 'reconnecting'
											? 'Reconnecting...'
											: upgrade.phase === 'staged'
												? 'Finish update'
												: 'Restart daemon'}
									</button>
								)}
							</div>
							{restart.phase === 'complete' && (
								<output className="block border-t border-border/40 px-5 py-3 text-xs text-emerald-500">
									{restart.targetVersion
										? `Otto v${restart.targetVersion} is running.`
										: 'The daemon restarted successfully.'}
								</output>
							)}
							{restart.phase === 'error' && (
								<p
									role="alert"
									className="border-t border-border/40 px-5 py-3 text-xs text-destructive"
								>
									{restart.message}
								</p>
							)}
						</div>
					</section>

					<section aria-labelledby={updatesHeadingId}>
						<div className="mb-3 flex items-center gap-2">
							<Download className="h-4 w-4 text-muted-foreground" />
							<h2 id={updatesHeadingId} className="text-sm font-semibold">
								Updates
							</h2>
						</div>
						<div className="rounded-xl border border-border/50 bg-card/40">
							<div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
								<div className="min-w-0 flex-1">
									<p className="flex items-center gap-2 text-sm font-medium">
										{!updateTarget && versionsComparable && (
											<CheckCircle2 className="h-4 w-4 text-emerald-500" />
										)}
										{upgrade.phase === 'staged'
											? `Otto v${upgrade.targetVersion} is downloaded`
											: updateTarget
												? `Otto v${updateTarget} is available`
												: hostIsNewer
													? 'This daemon is newer than the desktop CLI'
													: versionsMatch
														? 'This daemon is up to date'
														: 'Update status unavailable'}
									</p>
									<p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
										{upgrade.phase === 'staged'
											? `Restart Otto on ${machineName} to finish the update.`
											: hostVersion
												? `Installed version v${hostVersion}${clientRelease ? ` · Desktop CLI v${clientRelease}` : ''}`
												: 'The remote daemon did not report a release version.'}
									</p>
								</div>
								{canUpdate && upgrade.phase !== 'staged' && (
									<button
										type="button"
										onClick={() => void updateDaemon()}
										disabled={
											upgrade.phase === 'staging' ||
											restart.phase === 'reconnecting'
										}
										className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
									>
										{upgrade.phase === 'staging' ? (
											<StableSpinner size="sm" title="Updating CLI" />
										) : (
											<Download className="h-3.5 w-3.5" />
										)}
										{upgrade.phase === 'staging'
											? 'Updating CLI...'
											: 'Update CLI'}
									</button>
								)}
							</div>

							{updateTarget && !canUpdate && (
								<p className="border-t border-border/40 px-5 py-4 text-xs leading-relaxed text-muted-foreground">
									This daemon cannot update and restart automatically. On{' '}
									{machineName}, run{' '}
									<code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
										otto upgrade &amp;&amp; otto service restart
									</code>
									.
								</p>
							)}
							{upgrade.phase === 'error' && (
								<p
									role="alert"
									className="border-t border-border/40 px-5 py-3 text-xs text-destructive"
								>
									{upgrade.message}
								</p>
							)}
						</div>
					</section>
				</div>
			</main>
		</div>
	);
}
