import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Brain, Search } from 'lucide-react';
import {
	type CompactActivityEntry,
	summarizeCompactActivities,
} from './compactActivity';
import { useIsCompactThread } from './threadDensity';

const ANIM_MS = 320;
const EASING = 'cubic-bezier(0.25, 1, 0.5, 1)';
const MAX_SCROLL_H = 140;
const MIN_LIVE_H = 28;

interface CompactActivityGroupProps {
	entries: CompactActivityEntry[];
	titleOverride?: string;
	showLine: boolean;
	collapsed: boolean;
	compact?: boolean;
}

export function CompactActivityGroup({
	entries,
	titleOverride,
	showLine,
	collapsed,
	compact,
}: CompactActivityGroupProps) {
	const isCompactThread = useIsCompactThread();
	const isCompact = Boolean(compact || isCompactThread);
	const mountedCollapsed = collapsed && entries.length > 0;
	const [showSummary, setShowSummary] = useState(mountedCollapsed);
	const [renderLiveEntries, setRenderLiveEntries] = useState(!mountedCollapsed);
	const [latched, setLatched] = useState(mountedCollapsed);
	const contentMeasureRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const scrollAnimationRef = useRef<number | null>(null);
	const hoveredRef = useRef(false);
	const prevCountRef = useRef(entries.length);
	const [contentHeight, setContentHeight] = useState(
		mountedCollapsed ? 0 : MIN_LIVE_H,
	);

	const summary = useMemo(() => summarizeCompactActivities(entries), [entries]);
	const summaryTitle = titleOverride || summary.title;
	const summaryText = [summaryTitle, ...summary.details].join('\u00A0· ');
	const hasReasoning = entries.some((e) => e.toolName === 'reasoning');

	const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
	const collapseTimerRef = useRef<number | null>(null);
	const unmountTimerRef = useRef<number | null>(null);

	useEffect(() => {
		if (collapseTimerRef.current !== null) {
			window.clearTimeout(collapseTimerRef.current);
			collapseTimerRef.current = null;
		}
		if (!collapsed) {
			setLatched(false);
			setRenderLiveEntries(true);
			setShowSummary(false);
			return;
		}
		if (!latched && collapsed) {
			setLatched(true);
		}
		if (showSummary) return;
		if (entries.length === 0) return;
		collapseTimerRef.current = window.setTimeout(() => {
			setShowSummary(true);
			collapseTimerRef.current = null;
		}, 500);
	}, [collapsed, showSummary, latched, entries.length]);

	useEffect(() => {
		if (unmountTimerRef.current !== null) {
			window.clearTimeout(unmountTimerRef.current);
			unmountTimerRef.current = null;
		}
		if (!showSummary) {
			setRenderLiveEntries(true);
			return;
		}
		// Keep the measured live content mounted while max-height collapses.
		// Removing it in the same render makes the box snap to a single line
		// before the transition can run, which is especially visible in Safari.
		unmountTimerRef.current = window.setTimeout(() => {
			setRenderLiveEntries(false);
			unmountTimerRef.current = null;
		}, ANIM_MS);
		return () => {
			if (unmountTimerRef.current !== null) {
				window.clearTimeout(unmountTimerRef.current);
				unmountTimerRef.current = null;
			}
		};
	}, [showSummary]);

	useLayoutEffect(() => {
		if (showSummary) return;
		const el = contentMeasureRef.current;
		if (!el) return;
		const updateHeight = () => {
			const nextHeight = Math.min(
				Math.max(el.scrollHeight, entries.length > 0 ? MIN_LIVE_H : 0),
				MAX_SCROLL_H,
			);
			setContentHeight((prev) => (prev === nextHeight ? prev : nextHeight));
		};
		updateHeight();
		const observer = new ResizeObserver(() => updateHeight());
		observer.observe(el);
		return () => observer.disconnect();
	}, [showSummary, entries.length]);

	useEffect(() => {
		return () => {
			if (scrollAnimationRef.current !== null) {
				window.cancelAnimationFrame(scrollAnimationRef.current);
			}
			if (collapseTimerRef.current !== null) {
				window.clearTimeout(collapseTimerRef.current);
			}
			if (unmountTimerRef.current !== null) {
				window.clearTimeout(unmountTimerRef.current);
			}
		};
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll on new entries or streaming text
	useEffect(() => {
		if (showSummary || hoveredRef.current) return;
		const el = scrollRef.current;
		if (!el) return;
		const naturalHeight = contentMeasureRef.current?.scrollHeight ?? 0;
		const isOverflowing = naturalHeight > contentHeight + 1;
		const targetTop = isOverflowing
			? Math.max(0, naturalHeight - contentHeight)
			: 0;

		if (scrollAnimationRef.current !== null) {
			window.cancelAnimationFrame(scrollAnimationRef.current);
			scrollAnimationRef.current = null;
		}

		if (!isOverflowing) {
			el.scrollTop = 0;
			return;
		}

		const startTop = el.scrollTop;
		const distance = targetTop - startTop;
		if (distance <= 1) {
			el.scrollTop = targetTop;
			return;
		}

		const startTime = performance.now();
		const duration = Math.min(360, Math.max(180, distance * 0.9));
		const tick = (now: number) => {
			const progress = Math.min(1, (now - startTime) / duration);
			const eased = 1 - (1 - progress) ** 3;
			el.scrollTop = startTop + distance * eased;
			if (progress < 1 && !hoveredRef.current) {
				scrollAnimationRef.current = window.requestAnimationFrame(tick);
				return;
			}
			scrollAnimationRef.current = null;
		};

		scrollAnimationRef.current = window.requestAnimationFrame(tick);
	}, [entries.length, lastEntry?.fullText, showSummary, contentHeight]);

	useEffect(() => {
		prevCountRef.current = entries.length;
	}, [entries.length]);

	const isLive = !showSummary;

	return (
		<div
			className={`flex ${isCompact ? 'gap-1.5' : 'gap-3'} pb-2 relative max-w-full overflow-hidden`}
		>
			<div
				className={`flex-shrink-0 ${isCompact ? 'w-4' : 'w-6'} flex items-start justify-center relative pt-0.5`}
			>
				<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative bg-background">
					{hasReasoning ? (
						<Brain className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
					) : (
						<Search className="h-4 w-4 text-amber-600 dark:text-amber-300" />
					)}
				</div>
				{showLine && (
					<div
						className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-border z-0"
						style={{ top: '1.25rem', bottom: '-0.5rem' }}
					/>
				)}
			</div>

			<div className="flex-1 min-w-0 pt-0.5">
				<div
					className="relative rounded-lg overflow-hidden"
					style={{
						border: isLive
							? '1px solid hsl(var(--border) / 0.6)'
							: '1px solid transparent',
						background: isLive ? 'hsl(var(--muted) / 0.2)' : 'transparent',
						padding: isLive ? (isCompact ? '6px 8px' : '8px 12px') : '0px 0px',
						transition: `border ${ANIM_MS}ms ${EASING}, background ${ANIM_MS}ms ${EASING}, padding ${ANIM_MS}ms ${EASING}`,
					}}
				>
					<div
						style={{
							overflow: 'hidden',
							opacity: isLive ? 1 : 0,
							maxHeight: isLive ? `${MAX_SCROLL_H + 28}px` : '0px',
							transition: `opacity ${ANIM_MS}ms ${EASING}, max-height ${ANIM_MS}ms ${EASING}`,
						}}
					>
						<div className="text-[12px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70 mb-1">
							Exploring
						</div>

						<div
							ref={scrollRef}
							className="overflow-y-auto"
							style={{
								height: `${contentHeight}px`,
								transition: `height ${ANIM_MS}ms ${EASING}`,
								willChange: 'height',
								maskImage:
									'linear-gradient(to bottom, transparent 0px, black 20px)',
								WebkitMaskImage:
									'linear-gradient(to bottom, transparent 0px, black 20px)',
							}}
							role="log"
							onMouseEnter={() => {
								hoveredRef.current = true;
							}}
							onMouseLeave={() => {
								hoveredRef.current = false;
							}}
						>
							{renderLiveEntries && (
								<div ref={contentMeasureRef} className="pt-2.5">
									{entries.map((entry, i) => {
										const isLast = i === entries.length - 1;
										const isNewAppend = i >= prevCountRef.current;
										const isReasoning = entry.toolName === 'reasoning';
										const showFullText =
											isReasoning && entry.fullText && entry.fullText.trim();

										if (showFullText) {
											return (
												<div
													key={entry.id}
													className="px-1 py-0.5"
													style={{
														animation: isNewAppend
															? `ottoEntryIn ${ANIM_MS}ms ${EASING} both`
															: undefined,
													}}
												>
													<p
														className={`text-[12px] leading-relaxed font-mono whitespace-pre-wrap ${
															isLast
																? 'text-foreground/80'
																: 'text-muted-foreground/60'
														}`}
													>
														{entry.fullText}
													</p>
												</div>
											);
										}

										return (
											<div
												key={entry.id}
												className={`flex items-center px-1 ${
													isCompact ? 'text-[13px] h-6' : 'text-[15px] h-7'
												} leading-5 ${
													isLast
														? 'text-foreground'
														: 'text-muted-foreground/70'
												}`}
												style={{
													animation: isNewAppend
														? `ottoEntryIn ${ANIM_MS}ms ${EASING} both`
														: undefined,
												}}
											>
												<span className="block min-w-0 truncate">
													{entry.label}
												</span>
											</div>
										);
									})}
								</div>
							)}
						</div>
					</div>

					<div
						className={`flex items-center ${
							isCompact ? 'text-[12px]' : 'text-xs'
						}`}
						style={{
							opacity: showSummary ? 1 : 0,
							height: showSummary ? '20px' : '0px',
							overflow: 'hidden',
							transition: `opacity ${ANIM_MS}ms ${EASING}, height ${ANIM_MS}ms ${EASING}`,
						}}
					>
						<span
							className="block min-w-0 truncate leading-none text-foreground"
							title={summaryText}
						>
							{summaryText}
						</span>
					</div>
				</div>
			</div>

			<style>{`@keyframes ottoEntryIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
		</div>
	);
}
