import { useNavigate } from '@tanstack/react-router';
import { themeList, type ThemeId } from '@ottocode/themes';
import { StableSpinner, TitleBar } from '@ottocode/web-sdk/components';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
	Check,
	ChevronDown,
	Download,
	TerminalSquare,
	MoonStar,
	Power,
	RefreshCw,
	RotateCw,
	Sun,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import { useFullscreen } from '../hooks/useFullscreen';
import { usePlatform } from '../hooks/usePlatform';
import { useUpdate } from '../hooks/useUpdate';
import { useVersion } from '../hooks/useVersion';
import type { CliSelectionInfo, ServerInfo } from '../lib/tauri-bridge';
import { useDesktopTheme } from '../theme';
import { handleTitleBarDrag } from '../utils/title-bar';
import { OttoWordmark } from './Icons';
import { WindowControls } from './WindowControls';

type DaemonAction = 'start' | 'restart' | 'stop';

interface DesktopSettingsProps {
	daemon: ServerInfo | null;
	cliSelection: CliSelectionInfo | null;
	onStartDaemon: () => Promise<void>;
	onStopDaemon: () => Promise<void>;
	onRestartDaemon: () => Promise<void>;
	onUpdateInstalledCli: () => Promise<void>;
}

/** Focused desktop settings for appearance, updates, and daemon lifecycle. */
export function DesktopSettings({
	daemon,
	cliSelection,
	onStartDaemon,
	onStopDaemon,
	onRestartDaemon,
	onUpdateInstalledCli,
}: DesktopSettingsProps) {
	const navigate = useNavigate();
	const platform = usePlatform();
	const isFullscreen = useFullscreen();
	const appVersion = useVersion();
	const { theme, setTheme } = useDesktopTheme();
	const [selectedTheme, setSelectedTheme] = useState<ThemeId>(theme);
	const [appearanceOpen, setAppearanceOpen] = useState(false);
	const appearanceHeadingId = useId();
	const appearancePanelId = useId();
	const runtimeHeadingId = useId();
	const updatesHeadingId = useId();
	const cliHeadingId = useId();
	const [daemonAction, setDaemonAction] = useState<DaemonAction | null>(null);
	const [daemonError, setDaemonError] = useState<string | null>(null);
	const [updatingCli, setUpdatingCli] = useState(false);
	const [cliError, setCliError] = useState<string | null>(null);
	const {
		available: updateAvailable,
		version: updateVersion,
		downloading,
		downloaded,
		progress,
		downloadUpdate,
		applyUpdate,
	} = useUpdate();

	useEffect(() => {
		setSelectedTheme(theme);
	}, [theme]);

	const selectedThemeName =
		themeList.find((option) => option.id === selectedTheme)?.displayName ??
		selectedTheme;

	const handleSelectTheme = (themeId: ThemeId) => {
		setSelectedTheme(themeId);
		setTheme(themeId);
	};

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
		if (daemonAction !== null) return;
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

	const handleUpdateCli = async () => {
		setUpdatingCli(true);
		setCliError(null);
		try {
			await onUpdateInstalledCli();
		} catch (cause) {
			setCliError(
				cause instanceof Error ? cause.message : 'The CLI update failed.',
			);
		} finally {
			setUpdatingCli(false);
		}
	};

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
			<TitleBar
				onMouseDown={handleTitleBarDrag}
				dragRegion
				leadingInset={platform === 'macos' && !isFullscreen}
				onBack={() => void handleBackToProjects()}
				showSidebarToggle={false}
				title={<OttoWordmark height={16} className="text-foreground" />}
				trailing={platform === 'linux' ? <WindowControls /> : undefined}
			/>

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
						<div className="rounded-xl border border-border/50 bg-card/40">
							<button
								type="button"
								onClick={() => setAppearanceOpen((open) => !open)}
								aria-expanded={appearanceOpen}
								aria-controls={appearancePanelId}
								className="flex w-full items-center gap-3 rounded-xl px-5 py-4 text-left transition-colors hover:bg-muted/40"
							>
								<MoonStar className="h-4 w-4 shrink-0 text-muted-foreground" />
								<h2
									id={appearanceHeadingId}
									className="flex-1 text-sm font-semibold"
								>
									Appearance
								</h2>
								<span className="text-xs text-muted-foreground">
									{selectedThemeName}
								</span>
								<motion.span
									animate={{ rotate: appearanceOpen ? 180 : 0 }}
									transition={{ duration: 0.2, ease: 'easeOut' }}
									className="shrink-0"
								>
									<ChevronDown
										className="h-4 w-4 text-muted-foreground"
										aria-hidden="true"
									/>
								</motion.span>
							</button>
							<AnimatePresence initial={false}>
								{appearanceOpen && (
									<motion.div
										id={appearancePanelId}
										initial={{ height: 0, opacity: 0 }}
										animate={{ height: 'auto', opacity: 1 }}
										exit={{ height: 0, opacity: 0 }}
										transition={{
											height: { duration: 0.24, ease: 'easeOut' },
											opacity: { duration: 0.16, ease: 'easeOut' },
										}}
										className="overflow-hidden border-t border-border/40"
									>
										<div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
											{themeList.map((option) => {
												const selected = option.id === selectedTheme;
												return (
													<button
														type="button"
														key={option.id}
														onClick={() => handleSelectTheme(option.id)}
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
														{selected && (
															<Check className="h-4 w-4 text-primary" />
														)}
													</button>
												);
											})}
										</div>
									</motion.div>
								)}
							</AnimatePresence>
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

					<section className="mb-8" aria-labelledby={cliHeadingId}>
						<div className="mb-3 flex items-center gap-2">
							<TerminalSquare className="h-4 w-4 text-muted-foreground" />
							<h2 id={cliHeadingId} className="text-sm font-semibold">
								Command line
							</h2>
						</div>
						<div className="rounded-xl border border-border/50 bg-card/40">
							<div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium">
										{cliSelection?.localVersion
											? `Otto CLI v${cliSelection.localVersion}`
											: 'No installed Otto CLI found'}
									</p>
									<p className="mt-1.5 truncate text-xs text-muted-foreground">
										{cliSelection?.localPath ??
											'Install Otto in your PATH to use it from a terminal.'}
									</p>
									{cliSelection?.updateAvailable && (
										<p className="mt-2 text-xs text-amber-500">
											Bundled CLI v{cliSelection.embeddedVersion} is newer.
										</p>
									)}
								</div>
								{cliSelection?.updateAvailable && (
									<button
										type="button"
										onClick={() => void handleUpdateCli()}
										disabled={updatingCli}
										className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
									>
										{updatingCli ? (
											<StableSpinner size="sm" title="Updating CLI" />
										) : (
											<Download className="h-3.5 w-3.5" />
										)}
										Update CLI
									</button>
								)}
							</div>
							{cliError && (
								<p className="border-t border-border/40 px-5 py-3 text-xs text-destructive">
									{cliError}
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
