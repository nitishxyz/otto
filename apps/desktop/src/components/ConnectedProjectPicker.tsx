import {
	FolderOpen,
	MessageCircle,
	Monitor,
	RefreshCw,
	Search,
	Settings,
	ShieldAlert,
	Star,
	WifiOff,
} from 'lucide-react';
import {
	DirectoryBrowserModal,
	StableSpinner,
	TitleBar,
} from '@ottocode/web-sdk/components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { usePlatform } from '../hooks/usePlatform';
import { useFullscreen } from '../hooks/useFullscreen';
import {
	forgetMachineProject,
	loadAuthorizedMachineProjects,
	loadMachineDirectories,
	openMachineGeneralProject,
	openMachineProject,
	restartRemoteHost,
	setMachineProjectPinned,
	stageRemoteHostUpgrade,
} from '../lib/machine-api';
import { toConnectedProject } from '../lib/machine-project';
import {
	assessRemoteCompatibility,
	REMOTE_RESTART_CAPABILITY,
} from '../lib/remote-compatibility';
import type {
	MachineBootstrap,
	MachineProject,
	MachineProjectAccess,
	Project,
} from '../lib/tauri-bridge';
import { tauriBridge } from '../lib/tauri-bridge';
import { handleTitleBarDrag } from '../utils/title-bar';
import { OttoWordmark } from './Icons';
import { ProjectCard } from './ProjectCard';
import {
	RemoteClientTooOldPanel,
	RemoteHostTooOldPanel,
	RemoteLimitedNotice,
	type RemoteUpgradePhase,
} from './RemoteCompatibilityPanel';
import { WindowControls } from './WindowControls';

const STAGED_RECHECK_INTERVAL_MS = 7000;
const PROJECT_SEARCH_THRESHOLD = 10;
/** Renew the owner session shortly before the host expires it. */
const OWNER_SESSION_RENEW_LEAD_MS = 90_000;
const OWNER_SESSION_RENEW_CHECK_MS = 20_000;

type ReadyAccess = Extract<MachineProjectAccess, { status: 'ready' }>;

type RemoteAction = 'open' | 'general' | null;

interface RemoteProjectEntry {
	summary: MachineProject;
	project: Project;
}

function describeError(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export function ConnectedProjectPicker({
	machine,
	localDaemonUrl,
	onSelectProject,
	onLeaveMachine,
}: {
	machine: MachineBootstrap;
	localDaemonUrl: string;
	onSelectProject: (project: Project) => void;
	onLeaveMachine: () => Promise<void>;
}) {
	const [access, setAccess] = useState<MachineProjectAccess | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [clientRelease, setClientRelease] = useState<string | null>(null);
	const [upgrade, setUpgrade] = useState<RemoteUpgradePhase>({
		phase: 'idle',
	});
	const [rechecking, setRechecking] = useState(false);
	const [restartingUpgrade, setRestartingUpgrade] = useState(false);
	const [actionBusy, setActionBusy] = useState<RemoteAction>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [browserOpen, setBrowserOpen] = useState(false);
	const [projectSearch, setProjectSearch] = useState('');
	const renewingRef = useRef(false);
	const platform = usePlatform();
	const isFullscreen = useFullscreen();
	const navigate = useNavigate();
	const machineName = machine.name || machine.hostname || 'Otto machine';

	const loadProjects = useCallback(
		async (options?: { background?: boolean }) => {
			const background = options?.background === true;
			if (!background) {
				setLoading(true);
				setError(null);
			}
			try {
				setAccess(await loadAuthorizedMachineProjects(machine, localDaemonUrl));
				if (background) setError(null);
			} catch (cause) {
				if (!background) setError(String(cause));
			} finally {
				if (!background) setLoading(false);
			}
		},
		[localDaemonUrl, machine],
	);

	useEffect(() => {
		void loadProjects();
	}, [loadProjects]);

	useEffect(() => {
		let cancelled = false;
		void tauriBridge
			.getCliSelection()
			.then((selection) => {
				if (!cancelled) setClientRelease(selection.version || null);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	const ready = access?.status === 'ready' ? access : null;
	const gate = ready
		? assessRemoteCompatibility(ready.serverInfo, machineName, clientRelease)
		: null;
	const ownerSessionExpiresAt = ready?.ownerSessionExpiresAt ?? null;
	const canRestartRemote =
		ready?.serverInfo?.protocol?.capabilities?.includes(
			REMOTE_RESTART_CAPABILITY,
		) ?? false;

	// Keep the owner session valid while the landing stays open: force a broker
	// refresh shortly before expiry so entering a project never starts with a
	// stale session. Only this view's access state changes.
	useEffect(() => {
		if (ownerSessionExpiresAt === null) return;
		const renewAt = ownerSessionExpiresAt - OWNER_SESSION_RENEW_LEAD_MS;
		let cancelled = false;
		const renewIfDue = () => {
			if (renewingRef.current || Date.now() < renewAt) return;
			renewingRef.current = true;
			void loadAuthorizedMachineProjects(machine, localDaemonUrl, true)
				.then((next) => {
					if (!cancelled) setAccess(next);
				})
				.catch(() => {})
				.finally(() => {
					renewingRef.current = false;
				});
		};
		const interval = window.setInterval(
			renewIfDue,
			OWNER_SESSION_RENEW_CHECK_MS,
		);
		renewIfDue();
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [ownerSessionExpiresAt, machine, localDaemonUrl]);

	// After a staged upgrade, watch for the owner-managed host restart and
	// re-evaluate compatibility on each reconnect until the gate clears.
	useEffect(() => {
		if (upgrade.phase !== 'staged') return;
		if (gate && gate.kind !== 'host-too-old') {
			setUpgrade({ phase: 'idle' });
			return;
		}
		const interval = window.setInterval(() => {
			void loadProjects({ background: true });
		}, STAGED_RECHECK_INTERVAL_MS);
		return () => window.clearInterval(interval);
	}, [upgrade.phase, gate, loadProjects]);

	const stageUpgrade = useCallback(
		async (targetVersion: string) => {
			if (!ready) return;
			setUpgrade({ phase: 'staging', targetVersion });
			try {
				await stageRemoteHostUpgrade(
					ready.apiUrl,
					ready.ownerSession,
					targetVersion,
				);
				setUpgrade({ phase: 'staged', targetVersion });
			} catch (cause) {
				setUpgrade({
					phase: 'error',
					targetVersion,
					message: describeError(cause),
				});
			}
		},
		[ready],
	);

	const recheckCompatibility = useCallback(async () => {
		setRechecking(true);
		try {
			await loadProjects({ background: true });
		} finally {
			setRechecking(false);
		}
	}, [loadProjects]);

	const restartStagedUpgrade = useCallback(
		async (targetVersion: string) => {
			if (!ready || restartingUpgrade) return;
			setRestartingUpgrade(true);
			try {
				await restartRemoteHost(ready, targetVersion);
			} catch (cause) {
				setUpgrade({
					phase: 'error',
					targetVersion,
					message: describeError(cause),
				});
				setRestartingUpgrade(false);
			}
		},
		[ready, restartingUpgrade],
	);

	const enterProject = useCallback(
		(project: MachineProject, current: ReadyAccess) => {
			onSelectProject(
				toConnectedProject(
					project,
					current.apiUrl,
					current.ownerSession,
					current.ownerSessionExpiresAt,
				),
			);
		},
		[onSelectProject],
	);

	const handleOpenGeneral = useCallback(async () => {
		if (!ready || actionBusy) return;
		setActionBusy('general');
		setActionError(null);
		try {
			enterProject(await openMachineGeneralProject(ready), ready);
		} catch (cause) {
			setActionError(describeError(cause));
		} finally {
			setActionBusy(null);
		}
	}, [ready, actionBusy, enterProject]);

	const handleSelectDirectory = useCallback(
		async (path: string) => {
			if (!ready) return;
			setActionBusy('open');
			setActionError(null);
			try {
				const project = await openMachineProject(ready, path);
				setBrowserOpen(false);
				enterProject(project, ready);
			} catch (cause) {
				setActionError(describeError(cause));
			} finally {
				setActionBusy(null);
			}
		},
		[ready, enterProject],
	);

	const loadDirectories = useCallback(
		(path?: string) => {
			if (!ready) return Promise.reject(new Error('Machine is not ready.'));
			return loadMachineDirectories(ready, path);
		},
		[ready],
	);

	const handleTogglePin = useCallback(
		async (summary: MachineProject) => {
			if (!ready) return;
			setActionError(null);
			try {
				await setMachineProjectPinned(ready, summary.id, !summary.pinned);
				await loadProjects({ background: true });
			} catch (cause) {
				setActionError(describeError(cause));
			}
		},
		[ready, loadProjects],
	);

	const handleForget = useCallback(
		async (summary: MachineProject) => {
			if (!ready) return;
			setActionError(null);
			await forgetMachineProject(ready, summary.id);
			await loadProjects({ background: true });
		},
		[ready, loadProjects],
	);

	const entries = useMemo<RemoteProjectEntry[]>(() => {
		if (!ready) return [];
		return ready.projects.map((summary) => ({
			summary,
			project: toConnectedProject(
				summary,
				ready.apiUrl,
				ready.ownerSession,
				ready.ownerSessionExpiresAt,
			),
		}));
	}, [ready]);

	const filteredEntries = useMemo(() => {
		const query = projectSearch.trim().toLowerCase();
		if (!query) return entries;
		return entries.filter((entry) =>
			`${entry.summary.name} ${entry.summary.path}`
				.toLowerCase()
				.includes(query),
		);
	}, [entries, projectSearch]);

	const pinnedEntries = filteredEntries.filter((entry) => entry.summary.pinned);
	const recentEntries = filteredEntries.filter(
		(entry) => !entry.summary.pinned,
	);
	const showProjectSearch = entries.length > PROJECT_SEARCH_THRESHOLD;
	const hasProjectResults = filteredEntries.length > 0;

	const showProjects =
		!loading &&
		access?.status === 'ready' &&
		gate?.kind !== 'host-too-old' &&
		gate?.kind !== 'client-too-old';
	const showStatusPanel = !showProjects;

	const renderEntry = (entry: RemoteProjectEntry, pinned: boolean) => (
		<ProjectCard
			key={entry.summary.id}
			project={entry.project}
			pinned={pinned}
			onSelect={() => {
				if (ready) enterProject(entry.summary, ready);
			}}
			onTogglePin={() => void handleTogglePin(entry.summary)}
			onRemove={() => handleForget(entry.summary)}
		/>
	);

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
			<TitleBar
				onMouseDown={handleTitleBarDrag}
				dragRegion
				leadingInset={platform === 'macos' && !isFullscreen}
				onBack={() => void onLeaveMachine()}
				showSidebarToggle={false}
				title={<OttoWordmark height={16} className="text-foreground" />}
				trailing={
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => navigate({ to: '/settings' })}
							className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							title="Settings"
						>
							<Settings className="h-4 w-4" aria-hidden="true" />
						</button>
						{platform === 'linux' && <WindowControls />}
					</div>
				}
			/>

			<main className="flex-1 overflow-y-auto">
				<div className="relative flex min-h-full flex-col">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--ring)/0.04),transparent)]" />

					<div className="relative z-10 flex flex-1 flex-col items-center px-6 pb-12 pt-16">
						<div className="mb-10 text-center">
							<OttoWordmark
								height={40}
								className="mx-auto mb-4 text-foreground"
							/>
							<p className="mx-auto max-w-sm text-base text-muted-foreground">
								Open-source AI coding assistant
							</p>
						</div>

						<div className="w-full max-w-2xl">
							<div className="mb-8 flex items-center gap-4 rounded-xl border border-border/50 bg-card/40 px-4 py-3">
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/50">
									<Monitor className="h-4 w-4 text-muted-foreground" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
										Connected machine
									</p>
									<h1 className="mt-0.5 truncate text-sm font-semibold text-foreground">
										{machineName}
									</h1>
									{machine.hostname && machine.name && (
										<p className="truncate text-xs text-muted-foreground">
											{machine.hostname}
										</p>
									)}
								</div>
								<button
									type="button"
									onClick={() => void loadProjects()}
									disabled={loading}
									className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
								>
									{loading ? (
										<StableSpinner size="sm" title="Loading projects" />
									) : (
										<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
									)}
									Retry
								</button>
							</div>

							{!loading && gate?.kind === 'limited' && (
								<RemoteLimitedNotice reason={gate.reason} />
							)}

							{showStatusPanel && (
								<div className="overflow-hidden rounded-xl border border-border/50 bg-card/50">
									{loading && (
										<output className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-muted-foreground">
											<StableSpinner
												size="sm"
												title="Authorizing and loading projects"
											/>
											Authorizing and loading projects...
										</output>
									)}
									{!loading && error && (
										<div className="px-6 py-10 text-center">
											<p className="text-sm font-medium text-foreground">
												Projects unavailable
											</p>
											<p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
												{error}
											</p>
										</div>
									)}
									{!loading && access?.status === 'offline' && (
										<div className="px-6 py-10 text-center">
											<WifiOff className="mx-auto h-6 w-6 text-muted-foreground" />
											<p className="mt-3 text-sm font-medium text-foreground">
												Machine offline
											</p>
											<p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
												{access.message}
											</p>
										</div>
									)}
									{!loading && access?.status === 'unavailable' && (
										<div className="px-6 py-10 text-center">
											<ShieldAlert className="mx-auto h-6 w-6 text-muted-foreground" />
											<p className="mt-3 text-sm font-medium text-foreground">
												Secure authorization unavailable
											</p>
											<p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
												{access.message}
											</p>
										</div>
									)}
									{!loading && gate?.kind === 'host-too-old' && (
										<RemoteHostTooOldPanel
											machineName={machineName}
											hostVersion={gate.hostVersion}
											upgradeTarget={gate.upgradeTarget}
											guidance={gate.guidance}
											upgrade={upgrade}
											onStageUpgrade={(targetVersion) =>
												void stageUpgrade(targetVersion)
											}
											onRecheck={() => void recheckCompatibility()}
											rechecking={rechecking}
											canRestart={canRestartRemote}
											restarting={restartingUpgrade}
											onRestart={(targetVersion) =>
												void restartStagedUpgrade(targetVersion)
											}
										/>
									)}
									{!loading && gate?.kind === 'client-too-old' && (
										<RemoteClientTooOldPanel
											machineName={machineName}
											hostVersion={gate.hostVersion}
										/>
									)}
								</div>
							)}

							{showProjects && (
								<>
									<div className="mx-auto mb-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
										<button
											type="button"
											onClick={() => {
												setActionError(null);
												setBrowserOpen(true);
											}}
											disabled={actionBusy !== null}
											className="group flex flex-col items-center gap-3 rounded-xl border border-border/50 p-5 text-center transition-all duration-150 hover:border-border hover:bg-muted/30 disabled:opacity-60"
										>
											<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60 transition-colors group-hover:bg-muted">
												{actionBusy === 'open' ? (
													<StableSpinner size="sm" title="Opening project" />
												) : (
													<FolderOpen className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" />
												)}
											</div>
											<div>
												<div className="text-sm font-medium text-foreground">
													Open
												</div>
												<div className="mt-0.5 text-xs text-muted-foreground/60">
													Remote project
												</div>
											</div>
										</button>

										<button
											type="button"
											onClick={() => void handleOpenGeneral()}
											disabled={actionBusy !== null}
											className="group flex flex-col items-center gap-3 rounded-xl border border-border/50 p-5 text-center transition-all duration-150 hover:border-border hover:bg-muted/30 disabled:opacity-60"
										>
											<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60 transition-colors group-hover:bg-muted">
												{actionBusy === 'general' ? (
													<StableSpinner size="sm" title="Opening General" />
												) : (
													<MessageCircle className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" />
												)}
											</div>
											<div>
												<div className="text-sm font-medium text-foreground">
													General
												</div>
												<div className="mt-0.5 text-xs text-muted-foreground/60">
													No project
												</div>
											</div>
										</button>

										<button
											type="button"
											onClick={() => navigate({ to: '/machine-settings' })}
											disabled={actionBusy !== null}
											className="group flex flex-col items-center gap-3 rounded-xl border border-border/50 p-5 text-center transition-all duration-150 hover:border-border hover:bg-muted/30 disabled:opacity-60"
										>
											<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60 transition-colors group-hover:bg-muted">
												<Settings className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" />
											</div>
											<div>
												<div className="text-sm font-medium text-foreground">
													Machine
												</div>
												<div className="mt-0.5 text-xs text-muted-foreground/60">
													Settings & updates
												</div>
											</div>
										</button>
									</div>

									{actionError && (
										<p
											role="alert"
											className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
										>
											{actionError}
										</p>
									)}

									{entries.length > 0 ? (
										<div className="overflow-hidden rounded-xl border border-border/50 bg-card/50">
											{showProjectSearch && (
												<div className="border-b border-border/30 p-3">
													<label className="relative block">
														<span className="sr-only">Search projects</span>
														<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
														<input
															type="search"
															value={projectSearch}
															onChange={(event) =>
																setProjectSearch(event.target.value)
															}
															placeholder="Search projects..."
															className="h-9 w-full rounded-lg border border-border/50 bg-muted/30 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-ring/50"
														/>
													</label>
												</div>
											)}

											{pinnedEntries.length > 0 && (
												<div>
													<div className="px-4 pb-1 pt-3">
														<h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
															<Star className="h-3.5 w-3.5 text-yellow-500/70" />
															Pinned
														</h2>
													</div>
													<div className="px-1">
														{pinnedEntries.map((entry) =>
															renderEntry(entry, true),
														)}
													</div>
												</div>
											)}

											{pinnedEntries.length > 0 && recentEntries.length > 0 && (
												<div className="mx-4 border-t border-border/30" />
											)}

											{recentEntries.length > 0 && (
												<div>
													<div className="px-4 pb-1 pt-3">
														<h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
															Recent
														</h2>
													</div>
													<div className="px-1 pb-1">
														{recentEntries.map((entry) =>
															renderEntry(entry, false),
														)}
													</div>
												</div>
											)}

											{!hasProjectResults && (
												<div className="py-10 text-center text-sm text-muted-foreground/60">
													No matching projects
												</div>
											)}
										</div>
									) : (
										<div className="py-16 text-center">
											<div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50">
												<FolderOpen className="h-5 w-5 text-muted-foreground/40" />
											</div>
											<p className="text-sm text-muted-foreground/60">
												No projects on this machine
											</p>
											<p className="mt-1 text-xs text-muted-foreground/40">
												Open a folder on {machineName} to get started
											</p>
										</div>
									)}
								</>
							)}
						</div>
					</div>
				</div>
			</main>

			{ready && browserOpen && (
				<DirectoryBrowserModal
					isOpen={browserOpen}
					onClose={() => setBrowserOpen(false)}
					onSelect={(path) => void handleSelectDirectory(path)}
					loadDirectories={loadDirectories}
				/>
			)}
		</div>
	);
}
