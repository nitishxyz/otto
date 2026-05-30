import { useState, useCallback, useRef, useEffect } from 'react';
import { useProjects } from '../hooks/useProjects';
import { useGitHub } from '../hooks/useGitHub';
import { usePlatform } from '../hooks/usePlatform';
import { handleTitleBarDrag } from '../utils/title-bar';
import { tauriBridge, type Project } from '../lib/tauri-bridge';
import { OttoWordmark } from './Icons';
import { ProjectCard } from './ProjectCard';
import { DeviceCodeModal } from './DeviceCodeModal';
import { CloneModal } from './CloneModal';
import {
	Sun,
	Moon,
	ArrowDownToLine,
	RotateCw,
	FolderOpen,
	GitBranch,
	Link,
	MessageCircle,
	Star,
	X,
} from 'lucide-react';
import { useDesktopTheme } from '../theme';
import { WindowControls } from './WindowControls';
import { useUpdate } from '../hooks/useUpdate';
import { useVersion } from '../hooks/useVersion';

export function ProjectPicker({
	onSelectProject,
}: {
	onSelectProject: (project: Project) => void;
}) {
	const { projects, loading, openProjectDialog, removeProject, togglePinned } =
		useProjects();
	const {
		user,
		loading: githubLoading,
		isAuthenticated,
		oauthState,
		startOAuth,
		startPolling,
		cancelOAuth,
		logout,
		loadRepos,
		repos,
		cloneRepo,
	} = useGitHub();
	const [showCloneModal, setShowCloneModal] = useState(false);
	const [showOAuthModal, setShowOAuthModal] = useState(false);
	const [showConnectModal, setShowConnectModal] = useState(false);
	const [connectUrl, setConnectUrl] = useState('');
	const [connectName, setConnectName] = useState('');
	const [cloning, setCloning] = useState(false);
	const [cloningRepo, setCloningRepo] = useState<string | null>(null);
	const platform = usePlatform();
	const { theme, toggleTheme } = useDesktopTheme();
	const pageRef = useRef(1);
	const {
		available: updateAvailable,
		version: updateVersion,
		downloading,
		downloaded,
		progress: updateProgress,
		downloadUpdate,
		applyUpdate,
	} = useUpdate();
	const appVersion = useVersion();

	const handleOpenFolder = async () => {
		const project = await openProjectDialog();
		if (project) {
			onSelectProject(project);
		}
	};

	const handleCloneClick = async () => {
		if (githubLoading) return;
		if (!isAuthenticated) {
			setShowOAuthModal(true);
			await startOAuth();
		} else {
			setShowCloneModal(true);
			pageRef.current = 1;
			await loadRepos(1);
		}
	};

	const handleGeneral = async () => {
		try {
			const path = await tauriBridge.getGeneralWorkspacePath();
			const project: Project = {
				path,
				name: 'General',
				lastOpened: new Date().toISOString(),
				pinned: false,
				kind: 'general',
			};
			onSelectProject(project);
		} catch (err) {
			alert(`Failed to open General workspace: ${err}`);
		}
	};

	const handleConnect = () => {
		if (!connectUrl.trim()) return;
		try {
			const url = new URL(connectUrl.trim());
			const name = connectName.trim() || url.hostname;
			const project: Project = {
				path: `remote://${url.host}`,
				name,
				lastOpened: new Date().toISOString(),
				pinned: false,
				kind: 'remote',
				remoteUrl: connectUrl.trim(),
			};
			tauriBridge.saveRecentProject(project).catch(() => {});
			setShowConnectModal(false);
			setConnectUrl('');
			setConnectName('');
			onSelectProject(project);
		} catch {
			alert('Invalid URL. Please enter a valid API server URL.');
		}
	};

	const handleOAuthCancel = () => {
		cancelOAuth();
		setShowOAuthModal(false);
	};

	const handleStartPolling = (deviceCode: string, interval: number) => {
		startPolling(deviceCode, interval);
	};

	const handleSearch = useCallback(
		async (query: string) => {
			pageRef.current = 1;
			await loadRepos(1, query || undefined);
		},
		[loadRepos],
	);

	const handleLoadMore = useCallback(async () => {
		pageRef.current += 1;
		await loadRepos(pageRef.current);
	}, [loadRepos]);

	const handleCloneRepo = async (url: string, name: string) => {
		const homeDir = '~/Projects';
		const targetPath = `${homeDir}/${name}`;
		try {
			setCloning(true);
			const repoFullName =
				repos.find((r) => r.clone_url === url)?.full_name || name;
			setCloningRepo(repoFullName);
			const resolvedPath = await cloneRepo(url, targetPath);
			setShowCloneModal(false);
			const project: Project = {
				path: resolvedPath,
				name,
				lastOpened: new Date().toISOString(),
				pinned: false,
				kind: 'local',
			};
			onSelectProject(project);
		} catch (err) {
			alert(`Clone failed: ${err}`);
		} finally {
			setCloning(false);
			setCloningRepo(null);
		}
	};

	useEffect(() => {
		if (showOAuthModal && oauthState.step === 'complete' && isAuthenticated) {
			setShowOAuthModal(false);
			setShowCloneModal(true);
			pageRef.current = 1;
			loadRepos(1);
		}
	}, [showOAuthModal, oauthState.step, isAuthenticated, loadRepos]);

	const pinnedProjects = projects.filter((p) => p.pinned);
	const recentProjects = projects.filter((p) => !p.pinned);

	return (
		<div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
			<div
				className="shrink-0 flex items-center px-4 h-12 border-b border-border/50 cursor-default select-none relative"
				onMouseDown={handleTitleBarDrag}
				data-tauri-drag-region
				role="toolbar"
			>
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
					<OttoWordmark height={16} className="text-foreground" />
				</div>
				<div className="flex items-center gap-2 ml-auto">
					{isAuthenticated && (
						<div className="flex items-center gap-1.5 mr-2">
							{user?.avatar_url && (
								<img
									src={user.avatar_url}
									alt=""
									className="w-5 h-5 rounded-full"
								/>
							)}
							<span className="text-sm text-muted-foreground">
								{user?.login}
							</span>
							<button
								type="button"
								onClick={logout}
								className="text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1 hover:bg-muted rounded"
							>
								Disconnect
							</button>
						</div>
					)}
					{updateAvailable &&
						(downloaded ? (
							<button
								type="button"
								onClick={applyUpdate}
								className="h-7 px-3 flex items-center gap-1.5 text-sm font-medium bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors"
								title={`Restart to update to v${updateVersion}`}
							>
								<RotateCw className="w-4 h-4" />
								Restart
							</button>
						) : (
							<button
								type="button"
								onClick={downloadUpdate}
								disabled={downloading}
								className="h-7 px-3 flex items-center gap-1.5 text-sm font-medium bg-blue-600 text-white rounded-full hover:bg-blue-500 transition-colors disabled:opacity-60"
								title={`Update to v${updateVersion}`}
							>
								<ArrowDownToLine className="w-4 h-4" />
								{downloading ? `${updateProgress}%` : 'Update'}
							</button>
						))}
					<button
						type="button"
						onClick={toggleTheme}
						className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
						title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
					>
						{theme === 'dark' ? (
							<Sun className="w-4 h-4" />
						) : (
							<Moon className="w-4 h-4" />
						)}
					</button>
					<button
						type="button"
						onClick={() => tauriBridge.createNewWindow()}
						className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
						title="New Window"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							aria-hidden="true"
						>
							<rect x="1" y="1" width="14" height="14" rx="2" />
							<line x1="8" y1="4.5" x2="8" y2="11.5" />
							<line x1="4.5" y1="8" x2="11.5" y2="8" />
						</svg>
					</button>
					{platform === 'linux' && <WindowControls />}
				</div>
			</div>

			<div className="flex-1 overflow-y-auto">
				<div className="relative min-h-full flex flex-col">
					<div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--ring)/0.04),transparent)] pointer-events-none" />

					<div className="relative z-10 flex-1 flex flex-col items-center pt-16 pb-12 px-6">
						<div className="text-center mb-12">
							<OttoWordmark
								height={40}
								className="text-foreground mx-auto mb-4"
							/>
							<p className="text-base text-muted-foreground max-w-sm mx-auto">
								Open-source AI coding assistant
							</p>
							{appVersion && (
								<span className="text-xs text-muted-foreground/40 mt-2 block">
									v{appVersion}
								</span>
							)}
						</div>

						<div className="w-full max-w-2xl">
							<div className="grid grid-cols-4 gap-3 mb-10">
								<button
									type="button"
									onClick={handleOpenFolder}
									className="group flex flex-col items-center gap-3 p-5 rounded-xl border border-border/50 hover:border-border hover:bg-muted/30 transition-all duration-150 text-center"
								>
									<div className="w-10 h-10 rounded-lg bg-muted/60 group-hover:bg-muted flex items-center justify-center transition-colors">
										<FolderOpen className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
									</div>
									<div>
										<div className="text-sm font-medium text-foreground">
											Open
										</div>
										<div className="text-xs text-muted-foreground/60 mt-0.5">
											Local project
										</div>
									</div>
								</button>

								<button
									type="button"
									onClick={handleGeneral}
									className="group flex flex-col items-center gap-3 p-5 rounded-xl border border-border/50 hover:border-border hover:bg-muted/30 transition-all duration-150 text-center"
								>
									<div className="w-10 h-10 rounded-lg bg-muted/60 group-hover:bg-muted flex items-center justify-center transition-colors">
										<MessageCircle className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
									</div>
									<div>
										<div className="text-sm font-medium text-foreground">
											General
										</div>
										<div className="text-xs text-muted-foreground/60 mt-0.5">
											No project
										</div>
									</div>
								</button>

								<button
									type="button"
									onClick={handleCloneClick}
									className="group flex flex-col items-center gap-3 p-5 rounded-xl border border-border/50 hover:border-border hover:bg-muted/30 transition-all duration-150 text-center"
								>
									<div className="w-10 h-10 rounded-lg bg-muted/60 group-hover:bg-muted flex items-center justify-center transition-colors">
										<GitBranch className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
									</div>
									<div>
										<div className="text-sm font-medium text-foreground">
											{githubLoading
												? 'GitHub'
												: isAuthenticated
													? 'Clone'
													: 'GitHub'}
										</div>
										<div className="text-xs text-muted-foreground/60 mt-0.5">
											{githubLoading
												? 'Checking...'
												: isAuthenticated
													? 'From repository'
													: 'Connect & clone'}
										</div>
									</div>
								</button>

								<button
									type="button"
									onClick={() => setShowConnectModal(true)}
									className="group flex flex-col items-center gap-3 p-5 rounded-xl border border-border/50 hover:border-border hover:bg-muted/30 transition-all duration-150 text-center"
								>
									<div className="w-10 h-10 rounded-lg bg-muted/60 group-hover:bg-muted flex items-center justify-center transition-colors">
										<Link className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
									</div>
									<div>
										<div className="text-sm font-medium text-foreground">
											Connect
										</div>
										<div className="text-xs text-muted-foreground/60 mt-0.5">
											Remote server
										</div>
									</div>
								</button>
							</div>

							{(pinnedProjects.length > 0 || recentProjects.length > 0) && (
								<div className="bg-card/50 border border-border/50 rounded-xl overflow-hidden">
									{pinnedProjects.length > 0 && (
										<div>
											<div className="px-4 pt-3 pb-1">
												<h2 className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider flex items-center gap-1.5">
													<Star className="w-3.5 h-3.5 text-yellow-500/70" />
													Pinned
												</h2>
											</div>
											<div className="px-1">
												{pinnedProjects.map((project) => (
													<ProjectCard
														key={project.path}
														project={project}
														pinned={true}
														onSelect={() => onSelectProject(project)}
														onTogglePin={() => togglePinned(project.path)}
														onRemove={() => removeProject(project.path)}
													/>
												))}
											</div>
										</div>
									)}

									{pinnedProjects.length > 0 && recentProjects.length > 0 && (
										<div className="mx-4 border-t border-border/30" />
									)}

									{recentProjects.length > 0 && (
										<div>
											<div className="px-4 pt-3 pb-1">
												<h2 className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
													Recent
												</h2>
											</div>
											<div className="px-1 pb-1">
												{recentProjects.map((project) => (
													<ProjectCard
														key={project.path}
														project={project}
														pinned={false}
														onSelect={() => onSelectProject(project)}
														onTogglePin={() => togglePinned(project.path)}
														onRemove={() => removeProject(project.path)}
													/>
												))}
											</div>
										</div>
									)}
								</div>
							)}

							{loading && projects.length === 0 && (
								<div className="text-center py-16 text-sm text-muted-foreground/60">
									Loading...
								</div>
							)}

							{!loading && projects.length === 0 && (
								<div className="text-center py-16">
									<div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
										<FolderOpen className="w-5 h-5 text-muted-foreground/40" />
									</div>
									<p className="text-sm text-muted-foreground/60">
										No recent projects
									</p>
									<p className="text-xs text-muted-foreground/40 mt-1">
										Open a folder to get started
									</p>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>

			{showOAuthModal && oauthState.step !== 'complete' && (
				<DeviceCodeModal
					oauthState={oauthState}
					onStartPolling={handleStartPolling}
					onCancel={handleOAuthCancel}
				/>
			)}

			{showCloneModal && (
				<CloneModal
					repos={repos}
					cloning={cloning}
					cloningRepo={cloningRepo}
					onClone={handleCloneRepo}
					onClose={() => setShowCloneModal(false)}
					onSearch={handleSearch}
					onLoadMore={handleLoadMore}
				/>
			)}

			{showConnectModal && (
				// biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop dismiss
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
					onClick={() => {
						setShowConnectModal(false);
						setConnectUrl('');
						setConnectName('');
					}}
					onKeyDown={(e) => {
						if (e.key === 'Escape') {
							setShowConnectModal(false);
							setConnectUrl('');
							setConnectName('');
						}
					}}
					tabIndex={-1}
				>
					<div
						className="bg-background border border-border/50 rounded-xl w-full max-w-sm mx-6 shadow-2xl overflow-hidden"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
						role="dialog"
					>
						<div className="flex items-center justify-between px-5 py-4">
							<div className="flex items-center gap-2.5">
								<div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center">
									<Link className="w-4 h-4 text-muted-foreground" />
								</div>
								<h3 className="text-sm font-semibold text-foreground">
									Connect to Server
								</h3>
							</div>
							<button
								type="button"
								onClick={() => {
									setShowConnectModal(false);
									setConnectUrl('');
									setConnectName('');
								}}
								className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
							>
								<X className="w-4 h-4" />
							</button>
						</div>

						<div className="px-5 pb-5 space-y-3">
							<div>
								<label className="block text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5">
									API Server URL
									<input
										type="url"
										value={connectUrl}
										onChange={(e) => setConnectUrl(e.target.value)}
										placeholder="http://192.168.1.50:9100"
										className="w-full h-9 px-3 bg-muted/30 border border-border/50 rounded-lg text-xs font-mono text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-ring/50 transition-colors"
										onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
									/>
								</label>
							</div>
							<div>
								<label className="block text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5">
									Name (optional)
									<input
										type="text"
										value={connectName}
										onChange={(e) => setConnectName(e.target.value)}
										placeholder="My Remote Server"
										className="w-full h-9 px-3 bg-muted/30 border border-border/50 rounded-lg text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-ring/50 transition-colors"
										onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
									/>
								</label>
							</div>
							<div className="flex justify-end gap-2 pt-1">
								<button
									type="button"
									onClick={() => {
										setShowConnectModal(false);
										setConnectUrl('');
										setConnectName('');
									}}
									className="px-3.5 h-9 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleConnect}
									disabled={!connectUrl.trim()}
									className="px-3.5 h-9 text-xs bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-colors disabled:opacity-50"
								>
									Connect
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
