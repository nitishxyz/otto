import { memo, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileCode, Search } from 'lucide-react';
import { useFilePickerStore } from '../../stores/filePickerStore';
import { useFileBrowserStore } from '../../stores/fileBrowserStore';
import { useFiles } from '../../hooks/useFiles';

const PICKER_TRANSITION = { duration: 0.18, ease: [0.2, 0, 0, 1] } as const;

function fuzzyMatch(
	query: string,
	target: string,
): { match: boolean; score: number } {
	const q = query.toLowerCase();
	const t = target.toLowerCase();

	if (q.length === 0) return { match: true, score: 0 };
	if (t.includes(q)) return { match: true, score: 100 - t.indexOf(q) };

	let qi = 0;
	let score = 0;
	let lastMatchIdx = -1;

	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) {
			score += 10;
			if (lastMatchIdx === ti - 1) score += 5;
			if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '.') score += 8;
			lastMatchIdx = ti;
			qi++;
		}
	}

	return { match: qi === q.length, score };
}

export const QuickFilePicker = memo(function QuickFilePicker() {
	const isOpen = useFilePickerStore((s) => s.isOpen);
	return (
		<AnimatePresence>{isOpen && <QuickFilePickerContent />}</AnimatePresence>
	);
});

const QuickFilePickerContent = memo(function QuickFilePickerContent() {
	const close = useFilePickerStore((s) => s.close);
	const openFile = useFileBrowserStore((s) => s.openFile);

	const [query, setQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const { data: filesData } = useFiles({ enabled: true, query });

	const ignoredSet = useMemo(
		() => new Set(filesData?.ignoredFiles ?? []),
		[filesData?.ignoredFiles],
	);

	const filtered = useMemo(() => {
		if (!filesData?.files) return [];
		if (!query) return filesData.files.slice(0, 50);

		const results = filesData.files
			.map((file) => ({ file, ...fuzzyMatch(query, file) }))
			.filter((r) => r.match)
			.sort((a, b) => b.score - a.score)
			.slice(0, 50);

		return results.map((r) => r.file);
	}, [filesData?.files, query]);

	useEffect(() => {
		setTimeout(() => inputRef.current?.focus(), 0);
	}, []);

	useEffect(() => {
		const item = listRef.current?.children[selectedIndex] as
			| HTMLElement
			| undefined;
		item?.scrollIntoView({ block: 'nearest' });
	}, [selectedIndex]);

	const handleSelect = useCallback(
		(file: string) => {
			openFile(file);
			close();
		},
		[openFile, close],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
				e.preventDefault();
				setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
			} else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
				e.preventDefault();
				setSelectedIndex((i) => Math.max(i - 1, 0));
			} else if (e.key === 'Enter' && filtered[selectedIndex]) {
				e.preventDefault();
				handleSelect(filtered[selectedIndex]);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				close();
			}
		},
		[filtered, selectedIndex, handleSelect, close],
	);

	const handleBackdropClick = useCallback(
		(e: React.MouseEvent) => {
			if (e.target === e.currentTarget) close();
		},
		[close],
	);

	return (
		<motion.div
			role="dialog"
			aria-modal="true"
			className="fixed inset-0 bg-black/50 flex items-start justify-center z-[60] pt-[15vh]"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={PICKER_TRANSITION}
			onClick={handleBackdropClick}
			onKeyDown={(e) => {
				if (e.key === 'Escape') close();
			}}
		>
			<motion.div
				layout
				className="bg-background border border-border rounded-lg shadow-2xl w-full max-w-lg overflow-hidden"
				initial={{ opacity: 0, y: -8, scale: 0.98 }}
				animate={{ opacity: 1, y: 0, scale: 1 }}
				exit={{ opacity: 0, y: -6, scale: 0.98 }}
				transition={PICKER_TRANSITION}
			>
				<div className="flex items-center gap-2 px-3 border-b border-border">
					<Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setSelectedIndex(0);
						}}
						onKeyDown={handleKeyDown}
						placeholder="Search files by name..."
						className="flex-1 bg-transparent py-3 text-sm text-foreground placeholder-muted-foreground outline-none"
					/>
					<kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border font-mono">
						ESC
					</kbd>
				</div>

				<motion.div
					ref={listRef}
					layout
					className="max-h-[40vh] overflow-y-auto"
					transition={PICKER_TRANSITION}
				>
					{filtered.length === 0 ? (
						<div className="px-4 py-8 text-center text-sm text-muted-foreground">
							{query ? 'No matching files' : 'No files found'}
						</div>
					) : (
						filtered.map((file, idx) => {
							const isIgnored = ignoredSet.has(file);
							return (
								<button
									key={file}
									type="button"
									onClick={() => handleSelect(file)}
									className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
										idx === selectedIndex
											? 'bg-accent text-accent-foreground'
											: 'text-foreground/80 hover:bg-muted/50'
									} ${isIgnored ? 'opacity-40' : ''}`}
								>
									<FileCode className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
									<HighlightedPath path={file} query={query} />
									{isIgnored && (
										<span className="ml-auto text-[10px] text-muted-foreground italic">
											ignored
										</span>
									)}
								</button>
							);
						})
					)}
				</motion.div>

				{filtered.length > 0 && (
					<motion.div
						layout
						className="px-3 py-2 border-t border-border text-xs text-muted-foreground flex items-center gap-3"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={PICKER_TRANSITION}
					>
						<span>
							<kbd className="bg-muted px-1 py-0.5 rounded border border-border font-mono">
								↑↓
							</kbd>{' '}
							navigate
						</span>
						<span>
							<kbd className="bg-muted px-1 py-0.5 rounded border border-border font-mono">
								↵
							</kbd>{' '}
							open
						</span>
						<span className="ml-auto">{filtered.length} files</span>
					</motion.div>
				)}
			</motion.div>
		</motion.div>
	);
});

function HighlightedPath({ path, query }: { path: string; query: string }) {
	if (!query) {
		return <span className="truncate font-mono text-xs">{path}</span>;
	}

	const lowerPath = path.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const idx = lowerPath.indexOf(lowerQuery);

	if (idx >= 0) {
		return (
			<span className="truncate font-mono text-xs">
				{path.slice(0, idx)}
				<span className="text-primary font-semibold">
					{path.slice(idx, idx + query.length)}
				</span>
				{path.slice(idx + query.length)}
			</span>
		);
	}

	return <span className="truncate font-mono text-xs">{path}</span>;
}
