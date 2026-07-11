import { useNavigate } from '@tanstack/react-router';
import { themeList } from '@ottocode/themes';
import { StableSpinner } from '@ottocode/web-sdk/components';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
	ArrowLeft,
	Check,
	Download,
	MoonStar,
	Power,
	RefreshCw,
	RotateCw,
	Sun,
} from 'lucide-react';
import { useId, useState } from 'react';
import { usePlatform } from '../hooks/usePlatform';
import { useUpdate } from '../hooks/useUpdate';
import { useVersion } from '../hooks/useVersion';
import type { ServerInfo } from '../lib/tauri-bridge';
import { useDesktopTheme } from '../theme';
import { DesktopDragRegion } from './DesktopDragRegion';
import { OttoWordmark } from './Icons';
import { WindowControls } from './WindowControls';

type DaemonAction = 'start' | 'restart' | 'stop';

interface DesktopSettingsProps {
	daemon: ServerInfo | null;
	onStartDaemon: () => Promise<void>;
	onStopDaemon: () => Promise<void>;
	onRestartDaemon: () => Promise<void>;
}

/** Focused desktop settings for appearance, updates, and daemon lifecycle. */
export function DesktopSettings({
	daemon,
	onStartDaemon,
	onStopDaemon,
	onRestartDaemon,
}: DesktopSettingsProps) {
	const navigate = useNavigate();
	const platform = usePlatform();
	const appVersion = useVersion();
	const { theme, setTheme } = useDesktopTheme();
	const appearanceHeadingId = useId();
	const runtimeHeadingId = useId();
	const updatesHeadingId = useId();
	const [daemonAction, setDaemonAction] = useState<DaemonAction | null>(null);
	const [daemonError, setDaemonError] = useState<string | null>(null);
	const {
		available: updateAvailable,
		version: updateVersion,
		downloading,
		downloaded,
		progress,
		downloadUpdate,
		applyUpdate,
	} = useUpdate();

	const runDaemonAction = async (
		action: DaemonAction,
		callback: () => Promise<void>,
	) => {
		setDaemonAction(action);
		setDaemonError(null);
		try {
			await callback();
			return true;
		} catch (cause) {
			setDaemonError(
				cause instanceof Error ? cause.message : 'The daemon action failed.',
			);
			return false;
		} finally {
			setDaemonAction(null);
		}
	};

	const handleBackToProjects = async () => {
		if (!daemon && !(await runDaemonAction('start', onStartDaemon))) return;
		await navigate({ to: '/projects' });
	};

	const handleStopDaemon = async () => {
		const confirmed = await confirm(
			'Stop the local Otto daemon? Active local sessions will disconnect until it is started again.',
			{ title: 'Stop daemon', kind: 'warning' },
		);
		if (!confirmed) return;
		void runDaemonAction('stop', onStopDaemon);
	};

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
			<DesktopDragRegion className="relative flex h-12 shrink-0 cursor-default select-none items-center border-b border-border/50 px-4">
				<button
					type="button"
					onClick={() => void handleBackToProjects()}
					disabled={daemonAction !== null}
					className="relative z-10 flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" aria-hidden="true" />
					Projects
				</button>
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<OttoWordmark height={16} className="text-foreground" />
				</div>
				<div className="ml-auto">
					{platform === 'linux' && <WindowControls />}
				</div>
			</DesktopDragRegion>

			<main className="flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-3xl px-6 py-12">
					<div className="mb-10">
						<p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
							Desktop
						</p>
						<h1 className="mt-2 text-3xl font-semibold tracking-tight">
							Settings
						</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							Manage the essentials for this Otto installation.
						</p>
					</div>

					<section className="mb-8" aria-labelledby={appearanceHeadingId}>
						<div className="mb-3 flex items-center gap-2">
							<MoonStar className="h-4 w-4 text-muted-foreground" />
							<h2 id={appearanceHeadingId} className="text-sm font-semibold">
								Appearance
							</h2>
						</div>
						<div className="rounded-xl border border-border/50 bg-card/40 p-4">
							<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
								{themeList.map((option) => {
									const selected = option.id === theme;
									return (
										<button
											type="button"
											key={option.id}
											onClick={() => setTheme(option.id)}
											className={`flex min-h-16 items-center gap-3 rounded-lg border px-3 text-left transition-colors ${
												selected
													? 'border-primary/60 bg-primary/10'
													: 'border-border/40 hover:border-border hover:bg-muted/40'
											}`}
										>
											<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
												{option.mode === 'dark' ? (
													<MoonStar className="h-4 w-4" />
												) : (
													<Sun className="h-4 w-4" />
												)}
											</div>
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{option.displayName}
											</span>
											{selected && <Check className="h-4 w-4 text-primary" />}
										</button>
									);
								})}
							</div>
						</div>
					</section>

					<section className="mb-8" aria-labelledby={runtimeHeadingId}>
						<div className="mb-3 flex items-center gap-2">
							<Power className="h-4 w-4 text-muted-foreground" />
							<h2 id={runtimeHeadingId} className="text-sm font-semibold">
								Local daemon
							</h2>
						</div>
						<div className="rounded-xl border border-border/50 bg-card/40">
							<div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span
											className={`h-2 w-2 rounded-full ${daemon ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
										/>
										<p className="text-sm font-medium">
											{daemon ? 'Running' : 'Stopped'}
										</p>
									</div>
									<p className="mt-1.5 truncate text-xs text-muted-foreground">
										{daemon
											? `${daemon.url} · v${daemon.cliVersion} · PID ${daemon.pid}`
											: 'Start the daemon to open local projects and sessions.'}
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									{daemon ? (
										<>
											<button
												type="button"
												onClick={() =>
													void runDaemonAction('restart', onRestartDaemon)
												}
												disabled={daemonAction !== null}
												className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
											>
												{daemonAction === 'restart' ? (
													<StableSpinner size="sm" title="Restarting daemon" />
												) : (
													<RefreshCw className="h-3.5 w-3.5" />
												)}
												Restart
											</button>
											<button
												type="button"
												onClick={handleStopDaemon}
												disabled={daemonAction !== null}
												className="h-9 rounded-lg px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
											>
												Stop daemon
											</button>
										</>
									) : (
										<button
											type="button"
											onClick={() =>
												void runDaemonAction('start', onStartDaemon)
											}
											disabled={daemonAction !== null}
											className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
										>
											<Power className="h-3.5 w-3.5" />
											{daemonAction === 'start'
												? 'Starting...'
												: 'Start daemon'}
										</button>
									)}
								</div>
							</div>
							{daemonError && (
								<p className="border-t border-border/40 px-5 py-3 text-xs text-destructive">
									{daemonError}
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
						<div className="flex flex-col gap-4 rounded-xl border border-border/50 bg-card/40 p-5 sm:flex-row sm:items-center">
							<div className="flex-1">
								<p className="text-sm font-medium">
									{updateAvailable
										? `Otto ${updateVersion} is available`
										: 'Otto is up to date'}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									Installed version {appVersion ? `v${appVersion}` : 'unknown'}
								</p>
							</div>
							{updateAvailable && (
								<button
									type="button"
									onClick={downloaded ? applyUpdate : downloadUpdate}
									disabled={downloading}
									className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
								>
									{downloaded ? (
										<RotateCw className="h-3.5 w-3.5" />
									) : (
										<Download className="h-3.5 w-3.5" />
									)}
									{downloaded
										? 'Restart to update'
										: downloading
											? `Downloading ${progress}%`
											: 'Download update'}
								</button>
							)}
						</div>
					</section>
				</div>
			</main>
		</div>
	);
}
