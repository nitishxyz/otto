import {
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, GitBranch, Plus, RefreshCw, Search } from 'lucide-react';
import { useCheckoutBranch, useGitBranches } from '../../hooks/useGit';
import { StableSpinner } from '../ui/StableSpinner';
import type { GitBranchListItem } from '../../types/api';
import { GitCreateBranchModal } from './GitCreateBranchModal';

interface GitBranchSwitcherProps {
	currentBranch?: string;
	isDetached?: boolean;
	shortHeadSha?: string;
}

type BranchRow = {
	key: string;
	displayName: string;
	branch: GitBranchListItem;
	checkoutTarget: string;
};

function buildRows(
	branches: GitBranchListItem[],
	currentBranch?: string,
): BranchRow[] {
	return branches.map((branch) => {
		const current = !branch.remote && branch.name === currentBranch;
		if (branch.remote) {
			const remote = branch.remoteName ? `${branch.remoteName}/` : '';
			return {
				key: branch.fullName,
				displayName: `${remote}${branch.name}`,
				branch: { ...branch, current: false },
				checkoutTarget: `${remote}${branch.name}`,
			};
		}
		return {
			key: branch.fullName,
			displayName: branch.name,
			branch: { ...branch, current },
			checkoutTarget: branch.name,
		};
	});
}

export function GitBranchSwitcher({
	currentBranch,
	isDetached,
	shortHeadSha,
}: GitBranchSwitcherProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [showCreate, setShowCreate] = useState(false);
	const [query, setQuery] = useState('');
	const [activeIndex, setActiveIndex] = useState(0);
	const [actionError, setActionError] = useState<string | null>(null);
	const searchId = useId();
	const popoverRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	const {
		data,
		isLoading: branchesLoading,
		isFetching: branchesFetching,
		refetch,
	} = useGitBranches(isOpen);
	const checkoutBranch = useCheckoutBranch();

	const rows = useMemo(
		() => buildRows(data?.branches ?? [], currentBranch),
		[data, currentBranch],
	);
	const filteredRows = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return rows;
		return rows.filter(
			(row) =>
				row.displayName.toLowerCase().includes(q) ||
				row.branch.name.toLowerCase().includes(q),
		);
	}, [rows, query]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection whenever filtered query changes
	useEffect(() => {
		setActiveIndex(0);
	}, [query]);

	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as Node;
			if (popoverRef.current?.contains(target)) return;
			if (triggerRef.current?.contains(target)) return;
			setIsOpen(false);
		};

		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) {
			setQuery('');
			setActionError(null);
		} else {
			requestAnimationFrame(() => searchInputRef.current?.focus());
		}
	}, [isOpen]);

	useEffect(() => {
		const node = itemRefs.current.get(activeIndex);
		node?.scrollIntoView({ block: 'nearest' });
	}, [activeIndex]);

	const handleCheckout = async (target: string) => {
		setActionError(null);
		try {
			await checkoutBranch.mutateAsync(target);
			await refetch();
			setIsOpen(false);
		} catch (err) {
			setActionError(
				err instanceof Error ? err.message : 'Failed to switch branch',
			);
		}
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === 'ArrowDown' || e.key === 'j') {
			e.preventDefault();
			setActiveIndex((i) =>
				filteredRows.length === 0
					? 0
					: Math.min(i + 1, filteredRows.length - 1),
			);
			return;
		}
		if (e.key === 'ArrowUp' || e.key === 'k') {
			e.preventDefault();
			setActiveIndex((i) => Math.max(i - 1, 0));
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			const row = filteredRows[activeIndex];
			if (row) handleCheckout(row.checkoutTarget);
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			setIsOpen(false);
		}
	};

	const triggerLabel = isDetached
		? `HEAD ${shortHeadSha ?? ''}`.trim()
		: currentBranch || 'HEAD';

	return (
		<div className="relative flex items-center min-w-0">
			<button
				type="button"
				ref={triggerRef}
				onClick={() => setIsOpen((v) => !v)}
				className="flex items-center gap-1.5 min-w-0 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted/50"
				title="Switch branch"
			>
				<GitBranch className="w-3 h-3 flex-shrink-0" />
				<span className="truncate font-medium">{triggerLabel}</span>
				<svg
					className={`w-3 h-3 flex-shrink-0 transition-transform ${
						isOpen ? 'rotate-180' : ''
					}`}
					viewBox="0 0 12 12"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					aria-hidden="true"
				>
					<title>Toggle branch picker</title>
					<path d="M3 5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</button>

			<AnimatePresence>
				{isOpen && (
					<motion.div
						ref={popoverRef}
						role="dialog"
						aria-label="Switch branch"
						initial={{ opacity: 0, y: 6, scale: 0.98 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: 4, scale: 0.98 }}
						transition={{ duration: 0.12, ease: 'easeOut' }}
						className="absolute left-0 bottom-full mb-2 w-72 bg-popover border border-border rounded-md shadow-lg z-50 overflow-hidden"
						onKeyDown={handleKeyDown}
					>
						<div className="px-2 py-2 border-b border-border flex items-center gap-2">
							<Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
							<input
								id={searchId}
								ref={searchInputRef}
								type="text"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Search branches..."
								spellCheck={false}
								className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
							/>
							<button
								type="button"
								onClick={() => refetch()}
								className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
								title="Refresh branches"
								aria-label="Refresh branches"
							>
								<RefreshCw
									className={`w-3 h-3 ${
										branchesFetching ? 'animate-spin' : ''
									}`}
								/>
							</button>
						</div>

						<div ref={listRef} className="max-h-64 overflow-y-auto py-1">
							{branchesLoading && rows.length === 0 ? (
								<div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
									<StableSpinner size="xs" title="Loading branches" />
									Loading branches...
								</div>
							) : filteredRows.length === 0 ? (
								<div className="px-3 py-3 text-xs text-muted-foreground">
									{query.trim()
										? `No branches matching "${query}"`
										: 'No branches found'}
								</div>
							) : (
								filteredRows.map((row, index) => {
									const isActive = index === activeIndex;
									const isCurrent = row.branch.current;

									return (
										<motion.button
											type="button"
											key={row.key}
											ref={(el) => {
												if (el) itemRefs.current.set(index, el);
												else itemRefs.current.delete(index);
											}}
											onMouseEnter={() => setActiveIndex(index)}
											onClick={() => handleCheckout(row.checkoutTarget)}
											disabled={checkoutBranch.isPending}
											className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-colors ${
												isActive
													? 'bg-muted text-foreground'
													: 'text-foreground/90 hover:bg-muted/50'
											} ${isCurrent ? 'font-medium' : ''}`}
											whileTap={{ scale: 0.99 }}
										>
											<span className="w-3.5 flex justify-center flex-shrink-0">
												{isCurrent ? (
													<Check className="w-3.5 h-3.5 text-green-500" />
												) : null}
											</span>
											<span className="flex-1 min-w-0 font-mono truncate">
												{row.displayName}
											</span>
											{row.branch.remote && (
												<span className="text-[10px] uppercase tracking-wide text-muted-foreground flex-shrink-0">
													remote
												</span>
											)}
										</motion.button>
									);
								})
							)}
						</div>

						{actionError && (
							<div className="px-3 py-2 text-[11px] text-orange-500 border-t border-border break-words">
								{actionError}
							</div>
						)}

						<div className="border-t border-border">
							<button
								type="button"
								onClick={() => {
									setIsOpen(false);
									setShowCreate(true);
								}}
								className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-foreground hover:bg-muted/60 transition-colors"
							>
								<Plus className="w-3.5 h-3.5 text-primary" />
								Create new branch
							</button>
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			<GitCreateBranchModal
				isOpen={showCreate}
				onClose={() => setShowCreate(false)}
				currentBranch={currentBranch}
			/>
		</div>
	);
}
