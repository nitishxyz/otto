import { useEffect, useRef, useState } from 'react';
import { ArrowUp, CornerDownRight, Folder } from 'lucide-react';
import { apiClient } from '../../lib/api-client';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { StableSpinner } from '../ui/StableSpinner';

/** Directory page rendered by the browser, from any server-backed source. */
export interface DirectoryBrowserListing {
	path: string;
	parent: string | null;
	directories: Array<{ name: string; path: string }>;
}

export type DirectoryBrowserLoader = (
	path?: string,
) => Promise<DirectoryBrowserListing>;

interface DirectoryBrowserModalProps {
	isOpen: boolean;
	initialPath?: string;
	onClose: () => void;
	onSelect: (path: string) => void;
	/**
	 * Optional listing source. Defaults to the configured API client, so
	 * settings keeps browsing the current project's server.
	 */
	loadDirectories?: DirectoryBrowserLoader;
}

export function DirectoryBrowserModal({
	isOpen,
	initialPath,
	onClose,
	onSelect,
	loadDirectories,
}: DirectoryBrowserModalProps) {
	const [listing, setListing] = useState<DirectoryBrowserListing | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [requestedPath, setRequestedPath] = useState<string | undefined>(
		initialPath || undefined,
	);
	const loadDirectoriesRef = useRef<DirectoryBrowserLoader | undefined>(
		loadDirectories,
	);

	useEffect(() => {
		loadDirectoriesRef.current = loadDirectories;
	}, [loadDirectories]);

	useEffect(() => {
		if (!isOpen) return;
		setRequestedPath(initialPath || undefined);
	}, [isOpen, initialPath]);

	useEffect(() => {
		if (!isOpen) return;
		const handleEscapeCapture = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		};
		document.addEventListener('keydown', handleEscapeCapture, true);
		return () =>
			document.removeEventListener('keydown', handleEscapeCapture, true);
	}, [isOpen, onClose]);

	useEffect(() => {
		if (!isOpen) return;
		let cancelled = false;
		setIsLoading(true);
		setError(null);
		const load =
			loadDirectoriesRef.current ??
			((path?: string) => apiClient.listReferenceDirectories(path));
		load(requestedPath)
			.then((result) => {
				if (!cancelled) setListing(result);
			})
			.catch((cause: unknown) => {
				if (cancelled) return;
				setError(
					cause instanceof Error ? cause.message : 'Failed to list directories',
				);
			})
			.finally(() => {
				if (!cancelled) setIsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [isOpen, requestedPath]);

	if (!isOpen) return null;

	const segments = listing ? listing.path.split('/').filter(Boolean) : [];

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title="Choose a directory"
			maxWidth="md"
		>
			<div className="-m-6 flex h-[min(420px,70vh)] flex-col">
				<div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 bg-muted/20 px-3 py-2">
					<button
						type="button"
						onClick={() => setRequestedPath('/')}
						className="shrink-0 rounded px-1 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						/
					</button>
					{segments.map((segment, index) => {
						const target = `/${segments.slice(0, index + 1).join('/')}`;
						const isLast = index === segments.length - 1;
						return (
							<span key={target} className="flex shrink-0 items-center gap-1">
								<span className="text-[11px] text-muted-foreground/40">/</span>
								<button
									type="button"
									onClick={() => setRequestedPath(target)}
									className={`rounded px-1 py-0.5 font-mono text-[11px] transition-colors hover:bg-muted ${
										isLast
											? 'font-medium text-foreground'
											: 'text-muted-foreground hover:text-foreground'
									}`}
								>
									{segment}
								</button>
							</span>
						);
					})}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto py-1">
					{isLoading ? (
						<div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
							<StableSpinner title="Loading directories" /> Loading…
						</div>
					) : error ? (
						<p className="px-4 py-6 text-xs leading-relaxed text-red-400">
							{error}
						</p>
					) : listing ? (
						<>
							{listing.parent ? (
								<button
									type="button"
									onClick={() => setRequestedPath(listing.parent ?? undefined)}
									className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
								>
									<ArrowUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
									..
								</button>
							) : null}
							{listing.directories.map((directory) => (
								<button
									key={directory.path}
									type="button"
									onClick={() => setRequestedPath(directory.path)}
									className="group flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-muted/40"
								>
									<Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
									<span className="min-w-0 flex-1 truncate">
										{directory.name}
									</span>
									<CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50" />
								</button>
							))}
							{listing.directories.length === 0 ? (
								<p className="px-4 py-6 text-xs text-muted-foreground">
									No subdirectories.
								</p>
							) : null}
						</>
					) : null}
				</div>

				<div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/70 bg-muted/20 px-3 py-2.5">
					<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
						{listing?.path ?? ''}
					</span>
					<div className="flex shrink-0 items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={onClose}
							className="h-7 px-2.5 text-xs"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							onClick={() => {
								if (listing) onSelect(listing.path);
							}}
							disabled={!listing || isLoading}
							className="h-7 px-3 text-xs"
						>
							Select this folder
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
