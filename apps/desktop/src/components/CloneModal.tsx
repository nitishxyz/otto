import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, GitBranch, Lock, Package, Download } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { StableSpinner } from '@ottocode/web-sdk/components';

interface CloneProgress {
	receivedObjects: number;
	totalObjects: number;
	receivedBytes: number;
	percent: number;
	phase: string;
}

interface Repo {
	id: number;
	name: string;
	full_name: string;
	description: string | null;
	private: boolean;
	clone_url: string;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CloneModal({
	repos,
	cloning,
	cloningRepo,
	onClone,
	onClose,
	onSearch,
	onLoadMore,
}: {
	repos: Repo[];
	cloning: boolean;
	cloningRepo: string | null;
	onClone: (url: string, name: string) => void;
	onClose: () => void;
	onSearch: (query: string) => void;
	onLoadMore: () => void;
}) {
	const [searchQuery, setSearchQuery] = useState('');
	const [cloneUrl, setCloneUrl] = useState('');
	const [progress, setProgress] = useState<CloneProgress | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const handleSearch = useCallback(
		(query: string) => {
			setSearchQuery(query);
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => {
				onSearch(query);
			}, 300);
		},
		[onSearch],
	);

	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	useEffect(() => {
		if (!cloning) {
			setProgress(null);
			return;
		}
		const unlisten = listen<CloneProgress>('clone-progress', (event) => {
			setProgress(event.payload);
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [cloning]);

	const handleScroll = useCallback(() => {
		if (!listRef.current) return;
		const { scrollTop, scrollHeight, clientHeight } = listRef.current;
		if (scrollHeight - scrollTop - clientHeight < 100) {
			onLoadMore();
		}
	}, [onLoadMore]);

	const handleCloneUrl = () => {
		if (!cloneUrl.trim() || cloning) return;
		const name = cloneUrl
			.trim()
			.replace(/\.git$/, '')
			.split('/')
			.pop();
		if (name) {
			onClone(cloneUrl.trim(), name);
		}
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop overlay pattern
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={cloning ? undefined : onClose}
			onKeyDown={(e) => {
				if (e.key === 'Escape' && !cloning) onClose();
			}}
			tabIndex={-1}
		>
			<div
				className="bg-background border border-border/50 rounded-xl w-full max-w-lg mx-6 shadow-2xl max-h-[80vh] flex flex-col overflow-hidden"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="dialog"
			>
				<div className="shrink-0 flex items-center justify-between px-5 py-4">
					<div className="flex items-center gap-2.5">
						<div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center">
							<GitBranch className="w-4 h-4 text-muted-foreground" />
						</div>
						<h3 className="text-sm font-semibold text-foreground">
							Clone Repository
						</h3>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={cloning}
						className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{cloning && cloningRepo && (
					<div className="px-5 pb-3">
						<div className="p-3 bg-muted/30 border border-border/50 rounded-lg space-y-2.5">
							<div className="flex items-center gap-2.5">
								<StableSpinner
									className="shrink-0"
									title="Cloning repository"
								/>
								<div className="flex-1 min-w-0">
									<div className="text-xs font-medium text-foreground">
										Cloning {cloningRepo}
									</div>
									<div className="text-[11px] text-muted-foreground/60 mt-0.5">
										{progress
											? `${progress.phase} — ${progress.percent}% (${formatBytes(progress.receivedBytes)})`
											: 'Connecting...'}
									</div>
								</div>
							</div>
							<div className="w-full h-1 bg-border/50 rounded-full overflow-hidden">
								<div
									className="h-full bg-foreground/70 rounded-full transition-all duration-300"
									style={{ width: `${progress?.percent ?? 0}%` }}
								/>
							</div>
						</div>
					</div>
				)}

				<div className="shrink-0 px-5 pb-3 space-y-2">
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
						<input
							type="text"
							placeholder="Search repositories..."
							value={searchQuery}
							onChange={(e) => handleSearch(e.target.value)}
							disabled={cloning}
							className="w-full h-9 pl-8 pr-3 bg-muted/30 border border-border/50 rounded-lg text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-ring/50 transition-colors text-xs disabled:opacity-50"
						/>
					</div>
					<div className="flex gap-2">
						<input
							type="text"
							placeholder="Or paste a clone URL..."
							value={cloneUrl}
							onChange={(e) => setCloneUrl(e.target.value)}
							disabled={cloning}
							onKeyDown={(e) => {
								if (e.key === 'Enter') handleCloneUrl();
							}}
							className="flex-1 h-9 px-3 bg-muted/30 border border-border/50 rounded-lg text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-ring/50 transition-colors text-xs font-mono disabled:opacity-50"
						/>
						<button
							type="button"
							onClick={handleCloneUrl}
							disabled={!cloneUrl.trim() || cloning}
							className="px-3.5 h-9 bg-foreground text-background rounded-lg text-xs font-medium hover:opacity-90 transition-colors disabled:opacity-50"
						>
							Clone
						</button>
					</div>
				</div>

				<div className="mx-5 border-t border-border/30" />

				<div
					ref={listRef}
					className={`flex-1 overflow-y-auto scrollbar-hide ${cloning ? 'pointer-events-none opacity-60' : ''}`}
					onScroll={handleScroll}
				>
					{repos.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-16 text-center">
							<div className="w-10 h-10 rounded-lg bg-muted/40 flex items-center justify-center mb-3">
								<Package className="w-4 h-4 text-muted-foreground/40" />
							</div>
							<p className="text-xs text-muted-foreground/60">
								{searchQuery
									? 'No repositories found'
									: 'Loading repositories...'}
							</p>
						</div>
					) : (
						<div className="py-1.5 px-1.5">
							{repos.map((repo) => {
								const isThisCloning = cloning && cloningRepo === repo.full_name;
								return (
									<button
										type="button"
										key={repo.id}
										onClick={() => onClone(repo.clone_url, repo.name)}
										disabled={cloning}
										className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg transition-colors text-left group ${
											isThisCloning ? 'bg-muted/50' : 'hover:bg-muted/30'
										}`}
									>
										<div className="w-7 h-7 rounded-md bg-muted/50 group-hover:bg-muted flex items-center justify-center shrink-0 transition-colors">
											{repo.private ? (
												<Lock className="w-3 h-3 text-muted-foreground/60" />
											) : (
												<Package className="w-3 h-3 text-muted-foreground/60" />
											)}
										</div>
										<div className="flex-1 min-w-0">
											<div className="text-xs font-medium text-foreground truncate">
												{repo.full_name}
											</div>
											{repo.description && (
												<div className="text-[11px] text-muted-foreground/50 truncate mt-0.5">
													{repo.description}
												</div>
											)}
										</div>
										<div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
											{isThisCloning ? (
												<StableSpinner size="sm" title="Cloning" />
											) : (
												<Download className="w-3.5 h-3.5 text-muted-foreground/50" />
											)}
										</div>
									</button>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
