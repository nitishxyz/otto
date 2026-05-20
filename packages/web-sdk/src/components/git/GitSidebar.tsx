import { memo, useCallback, useEffect, useState } from 'react';
import {
	FolderGit2,
	ChevronRight,
	ChevronDown,
	Download,
	GitBranch,
	Globe,
	Plus,
	RefreshCw,
	Sparkles,
	Trash2,
	Upload,
	X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useGitStore } from '../../stores/gitStore';
import { usePanelWidthStore } from '../../stores/panelWidthStore';
import {
	useGitStatus,
	usePullChanges,
	usePushCommits,
	useGitInit,
	useGitRemotes,
	useAddRemote,
	useRemoveRemote,
} from '../../hooks/useGit';
import { Button } from '../ui/Button';
import { GitFileList } from './GitFileList';
import { ResizeHandle } from '../ui/ResizeHandle';
import { SidebarHeader } from '../ui/SidebarHeader';

const PANEL_KEY = 'git';
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 320;
const MAX_WIDTH = 600;

interface GitError {
	id: string;
	message: string;
	context?: string;
}

interface GitSidebarProps {
	onFixWithAI?: (errorMessage: string) => void;
}

export const GitSidebar = memo(function GitSidebar({
	onFixWithAI,
}: GitSidebarProps) {
	const isExpanded = useGitStore((state) => state.isExpanded);
	const collapseSidebar = useGitStore((state) => state.collapseSidebar);
	const panelWidth = usePanelWidthStore(
		(s) => s.widths[PANEL_KEY] ?? DEFAULT_WIDTH,
	);
	const { data: status, isLoading, error, refetch } = useGitStatus();
	const { data: remotes } = useGitRemotes();
	const queryClient = useQueryClient();
	const pushMutation = usePushCommits();
	const pullMutation = usePullChanges();
	const initMutation = useGitInit();
	const addRemoteMutation = useAddRemote();
	const removeRemoteMutation = useRemoveRemote();
	const [errors, setErrors] = useState<GitError[]>([]);
	const [showRemotes, setShowRemotes] = useState(false);
	const [showAddRemote, setShowAddRemote] = useState(false);
	const [remoteName, setRemoteName] = useState('origin');
	const [remoteUrl, setRemoteUrl] = useState('');
	const [confirmRemoveRemote, setConfirmRemoveRemote] = useState<string | null>(
		null,
	);

	useEffect(() => {
		if (isExpanded) {
			queryClient.invalidateQueries({ queryKey: ['git', 'status'] });
		}
	}, [isExpanded, queryClient]);

	const handleRefresh = () => {
		refetch();
	};

	const addError = useCallback((message: string, context?: string) => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		setErrors((prev) => [...prev, { id, message, context }]);
	}, []);

	const dismissError = useCallback((id: string) => {
		setErrors((prev) => prev.filter((e) => e.id !== id));
	}, []);

	const handlePush = async () => {
		try {
			await pushMutation.mutateAsync();
		} catch (err) {
			addError(
				err instanceof Error ? err.message : 'Failed to push',
				'git push',
			);
		}
	};

	const handlePull = async () => {
		try {
			await pullMutation.mutateAsync();
		} catch (err) {
			addError(
				err instanceof Error ? err.message : 'Failed to pull',
				'git pull',
			);
		}
	};

	const handleAddRemote = async () => {
		if (!remoteName.trim() || !remoteUrl.trim()) return;
		try {
			await addRemoteMutation.mutateAsync({
				name: remoteName.trim(),
				url: remoteUrl.trim(),
			});
			setRemoteName('origin');
			setRemoteUrl('');
			setShowAddRemote(false);
		} catch (err) {
			addError(
				err instanceof Error ? err.message : 'Failed to add remote',
				'git remote add',
			);
		}
	};

	const handleRemoveRemote = async (name: string) => {
		if (confirmRemoveRemote !== name) {
			setConfirmRemoveRemote(name);
			return;
		}
		setConfirmRemoveRemote(null);
		try {
			await removeRemoteMutation.mutateAsync(name);
		} catch (err) {
			addError(
				err instanceof Error ? err.message : 'Failed to remove remote',
				'git remote remove',
			);
		}
	};

	const handleFixWithAI = useCallback(
		(gitError: GitError) => {
			const prompt = gitError.context
				? `I got a git error during ${gitError.context}:\n\n${gitError.message}\n\nPlease help me fix this.`
				: `I got a git error:\n\n${gitError.message}\n\nPlease help me fix this.`;
			dismissError(gitError.id);
			onFixWithAI?.(prompt);
		},
		[onFixWithAI, dismissError],
	);

	if (!isExpanded) return null;

	const allFiles = [
		...(status?.conflicted || []),
		...(status?.staged || []),
		...(status?.unstaged || []),
		...(status?.untracked || []),
	];

	const totalChanges = allFiles.length;
	const hasRemotes = status?.remotes && status.remotes.length > 0;
	const hasUpstream = status?.hasUpstream ?? false;
	const canPush = status && hasRemotes && (status.ahead > 0 || !hasUpstream);
	const _canPull = !!status;
	const hasPendingPulls = status && status.behind > 0;
	const isActing = pushMutation.isPending || pullMutation.isPending;
	const isNotGitRepo =
		error instanceof Error &&
		error.message.toLowerCase().includes('not a git repository');

	const pushTitle = !hasRemotes
		? 'No remote configured'
		: !hasUpstream
			? 'Publish branch to remote'
			: canPush
				? `Push ${status?.ahead} commit(s) to remote`
				: 'Nothing to push';

	return (
		<div
			className="border-l border-sidebar-border sidebar-fade-in flex h-full relative"
			style={{ width: panelWidth }}
		>
			<ResizeHandle
				panelKey={PANEL_KEY}
				side="right"
				minWidth={MIN_WIDTH}
				maxWidth={MAX_WIDTH}
				defaultWidth={DEFAULT_WIDTH}
			/>
			<div className="flex-1 flex flex-col h-full min-w-0 w-full">
				<SidebarHeader
					icon={<GitBranch className="size-[15px]" />}
					title={
						<>
							Git Changes
							{totalChanges > 0 && (
								<span className="ml-2 text-xs text-muted-foreground">
									({totalChanges})
								</span>
							)}
						</>
					}
					onClose={collapseSidebar}
				/>

				<div className="flex-1 overflow-y-auto">
					{isLoading ? (
						<div className="p-4 text-sm text-muted-foreground">
							Loading git status...
						</div>
					) : isNotGitRepo ? (
						<div className="p-4 flex flex-col items-center justify-center gap-3 text-center">
							<FolderGit2 className="w-10 h-10 text-muted-foreground" />
							<div className="text-sm text-muted-foreground">
								No git repository found in this directory.
							</div>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => initMutation.mutate()}
								disabled={initMutation.isPending}
								className="gap-1.5"
							>
								<GitBranch
									className={`w-3.5 h-3.5 ${initMutation.isPending ? 'animate-spin' : ''}`}
								/>
								{initMutation.isPending
									? 'Initializing...'
									: 'Initialize Repository'}
							</Button>
							{initMutation.isError && (
								<span className="text-xs text-orange-500">
									{initMutation.error instanceof Error
										? initMutation.error.message
										: 'Failed to initialize'}
								</span>
							)}
						</div>
					) : error ? (
						<div className="p-3 text-sm text-muted-foreground">
							<div className="flex flex-col gap-2">
								<span className="text-orange-500">
									{error instanceof Error
										? error.message
										: 'Failed to load git status'}
								</span>
								<Button variant="secondary" size="sm" onClick={handleRefresh}>
									Retry
								</Button>
							</div>
						</div>
					) : !status || totalChanges === 0 ? (
						<div className="p-3 text-sm text-muted-foreground">
							No changes detected
						</div>
					) : (
						<GitFileList status={status} />
					)}
				</div>

				{status && !isNotGitRepo && !error && (
					<div className="border-t border-border">
						<button
							type="button"
							onClick={() => setShowRemotes(!showRemotes)}
							className="w-full px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
						>
							{showRemotes ? (
								<ChevronDown className="w-3 h-3" />
							) : (
								<ChevronRight className="w-3 h-3" />
							)}
							<Globe className="w-3 h-3" />
							<span>Remotes</span>
							{status.remotes && (
								<span className="ml-auto text-[10px] opacity-60">
									{status.remotes.length}
								</span>
							)}
						</button>
						{showRemotes && (
							<div className="px-3 pb-2 space-y-1">
								{remotes && remotes.length > 0 ? (
									remotes
										.filter((r) => r.type === 'fetch')
										.map((remote) => (
											<div
												key={remote.name}
												className="flex items-center gap-2 text-xs group"
											>
												<span className="font-medium text-foreground">
													{remote.name}
												</span>
												<span className="truncate text-muted-foreground flex-1 min-w-0">
													{remote.url}
												</span>
												<button
													type="button"
													onClick={() => {
														if (confirmRemoveRemote === remote.name) {
															handleRemoveRemote(remote.name);
														} else {
															setConfirmRemoveRemote(remote.name);
														}
													}}
													onBlur={() => setConfirmRemoveRemote(null)}
													disabled={removeRemoteMutation.isPending}
													className={`${confirmRemoveRemote === remote.name ? 'opacity-100 text-red-500' : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500'} transition-all p-0.5`}
													title={
														confirmRemoveRemote === remote.name
															? `Click again to confirm removing ${remote.name}`
															: `Remove ${remote.name}`
													}
												>
													{confirmRemoveRemote === remote.name ? (
														<span className="text-[10px] font-medium">
															Remove?
														</span>
													) : (
														<Trash2 className="w-3 h-3" />
													)}
												</button>
											</div>
										))
								) : (
									<div className="text-xs text-muted-foreground py-1">
										No remotes configured
									</div>
								)}
								{showAddRemote ? (
									<div className="space-y-1.5 pt-1">
										<input
											type="text"
											value={remoteName}
											onChange={(e) => setRemoteName(e.target.value)}
											placeholder="Name (e.g. origin)"
											className="w-full text-xs px-2 py-1 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
										/>
										<input
											type="text"
											value={remoteUrl}
											onChange={(e) => setRemoteUrl(e.target.value)}
											placeholder="URL (e.g. https://github.com/...)"
											className="w-full text-xs px-2 py-1 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
											onKeyDown={(e) => {
												if (e.key === 'Enter') handleAddRemote();
												if (e.key === 'Escape') setShowAddRemote(false);
											}}
										/>
										<div className="flex gap-1">
											<Button
												variant="secondary"
												size="sm"
												onClick={handleAddRemote}
												disabled={
													addRemoteMutation.isPending ||
													!remoteName.trim() ||
													!remoteUrl.trim()
												}
												className="flex-1 h-6 text-[10px]"
											>
												{addRemoteMutation.isPending ? 'Adding...' : 'Add'}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setShowAddRemote(false)}
												className="h-6 text-[10px]"
											>
												Cancel
											</Button>
										</div>
									</div>
								) : (
									<button
										type="button"
										onClick={() => setShowAddRemote(true)}
										className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
									>
										<Plus className="w-3 h-3" />
										<span>Add remote</span>
									</button>
								)}
							</div>
						)}
					</div>
				)}

				{errors.length > 0 && (
					<div className="border-t border-border">
						{errors.map((gitError) => (
							<div
								key={gitError.id}
								className="px-3 py-2 text-xs border-b border-border last:border-b-0 bg-orange-50 dark:bg-orange-950/20 flex items-start gap-2"
							>
								<span className="text-orange-500 flex-1 min-w-0 break-words">
									{gitError.message}
								</span>
								<div className="flex items-center gap-1 flex-shrink-0">
									{onFixWithAI && (
										<button
											type="button"
											onClick={() => handleFixWithAI(gitError)}
											className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
											title="Fix with AI"
										>
											<Sparkles className="w-3 h-3" />
											Fix
										</button>
									)}
									<button
										type="button"
										onClick={() => dismissError(gitError.id)}
										className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
										title="Dismiss"
									>
										<X className="w-3 h-3" />
									</button>
								</div>
							</div>
						))}
					</div>
				)}

				<div className="h-10 border-t border-border flex items-center gap-1 px-2">
					<Button
						variant="secondary"
						size="sm"
						onClick={handlePull}
						disabled={isActing || !hasRemotes || !hasUpstream}
						title={
							!hasRemotes
								? 'No remote configured'
								: !hasUpstream
									? 'Branch not published yet'
									: hasPendingPulls
										? `Pull ${status?.behind} commit(s) from remote`
										: 'Pull from remote'
						}
						className="flex-1 h-7 text-xs gap-1.5"
					>
						<Download
							className={`w-3.5 h-3.5 ${pullMutation.isPending ? 'animate-pulse' : ''}`}
						/>
						Pull
						{hasPendingPulls && (
							<span className="text-orange-500">↓{status?.behind}</span>
						)}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						onClick={handlePush}
						disabled={!canPush || isActing}
						title={pushTitle}
						className="flex-1 h-7 text-xs gap-1.5"
					>
						<Upload
							className={`w-3.5 h-3.5 ${pushMutation.isPending ? 'animate-pulse' : ''}`}
						/>
						{!hasUpstream && hasRemotes ? 'Publish' : 'Push'}
						{hasUpstream && status && status.ahead > 0 && (
							<span className="text-green-500">↑{status.ahead}</span>
						)}
					</Button>
				</div>

				<div className="h-12 px-3 border-t border-border text-xs text-muted-foreground flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 min-w-0 flex-1">
						<GitBranch className="w-3 h-3 flex-shrink-0" />
						{status?.branch && (
							<span className="truncate">{status.branch}</span>
						)}
						{status && !hasUpstream && hasRemotes && (
							<span className="text-[10px] text-orange-500 flex-shrink-0">
								unpublished
							</span>
						)}
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleRefresh}
						title="Refresh git status"
						className="h-6 w-6 flex-shrink-0"
						disabled={isLoading}
					>
						<RefreshCw
							className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`}
						/>
					</Button>
				</div>
			</div>
		</div>
	);
});
