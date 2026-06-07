import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Package } from 'lucide-react';
import type { MessagePart } from '../../types/api';
import { StableSpinner } from '../ui/StableSpinner';
import { useIsCompactThread } from './threadDensity';
import {
	getMessagePartText,
	summarizeCompactionText,
} from './compactionSummary';

const ANIM_MS = 320;
const EASING = 'cubic-bezier(0.25, 1, 0.5, 1)';
const MAX_SCROLL_H = 140;
const COMPLETE_SUMMARY_DELAY_MS = 500;

interface CompactionSummaryBoxProps {
	part: MessagePart;
	showLine: boolean;
	compact?: boolean;
}

export function CompactionSummaryBox({
	part,
	showLine,
	compact,
}: CompactionSummaryBoxProps) {
	const isCompactThread = useIsCompactThread();
	const isCompact = Boolean(compact || isCompactThread);
	const contentMeasureRef = useRef<HTMLPreElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const scrollAnimationRef = useRef<number | null>(null);
	const hoveredRef = useRef(false);
	const previousContentLengthRef = useRef(0);
	const [contentHeight, setContentHeight] = useState(0);

	const summaryText = getMessagePartText(part);
	const hasSummaryText = summaryText.trim().length > 0;
	const isComplete = Boolean(part.completedAt);
	const collapsedSummary = summarizeCompactionText(summaryText);

	const [showSummary, setShowSummary] = useState(() => isComplete);
	const [latched, setLatched] = useState(() => isComplete);

	useEffect(() => {
		if (!isComplete && !latched) {
			setShowSummary(false);
			return;
		}
		if (!latched && isComplete) {
			setLatched(true);
		}
		if (showSummary) return;
		if (!isComplete) return;
		const t = window.setTimeout(
			() => setShowSummary(true),
			COMPLETE_SUMMARY_DELAY_MS,
		);
		return () => window.clearTimeout(t);
	}, [isComplete, showSummary, latched]);

	useLayoutEffect(() => {
		if (!hasSummaryText) {
			setContentHeight(0);
			return;
		}
		const el = contentMeasureRef.current;
		if (!el || el.textContent !== summaryText) return;
		const nextHeight = Math.min(el.scrollHeight, MAX_SCROLL_H - 12);
		setContentHeight((prev) => (prev === nextHeight ? prev : nextHeight));
	}, [summaryText, hasSummaryText]);

	useEffect(() => {
		return () => {
			if (scrollAnimationRef.current !== null) {
				window.cancelAnimationFrame(scrollAnimationRef.current);
			}
		};
	}, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el || hoveredRef.current || showSummary) return;

		const nextLength = summaryText.length;
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
			previousContentLengthRef.current = nextLength;
			return;
		}

		if (nextLength <= previousContentLengthRef.current) {
			el.scrollTop = targetTop;
			previousContentLengthRef.current = nextLength;
			return;
		}

		const startTop = el.scrollTop;
		const distance = targetTop - startTop;
		if (distance <= 1) {
			el.scrollTop = targetTop;
			previousContentLengthRef.current = nextLength;
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
		previousContentLengthRef.current = nextLength;
	}, [summaryText, contentHeight, showSummary]);

	const isLive = !showSummary;

	return (
		<div
			className={`flex ${isCompact ? 'gap-1.5' : 'gap-3'} pb-2 relative max-w-full overflow-hidden`}
		>
			<div
				className={`flex-shrink-0 ${isCompact ? 'w-4' : 'w-6'} flex items-start justify-center relative pt-0.5`}
			>
				<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full relative bg-background">
					<Package className="h-4 w-4 text-sky-600 dark:text-sky-300" />
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
						<div
							className={`flex items-center gap-2 ${
								isCompact ? 'text-[13px]' : 'text-[14px]'
							} font-medium uppercase tracking-[0.18em] text-muted-foreground/70`}
						>
							<StableSpinner
								size="xs"
								className="flex-shrink-0"
								title="Compacting context"
							/>
							<span className="flex-shrink-0">Compacting</span>
							{!hasSummaryText && (
								<span className="text-muted-foreground/50 animate-pulse lowercase tracking-normal font-normal">
									summarizing…
								</span>
							)}
						</div>

						<div
							style={{
								overflow: 'hidden',
								opacity: hasSummaryText ? 1 : 0,
								height: hasSummaryText ? `${contentHeight + 6}px` : '0px',
								transition: `opacity ${ANIM_MS}ms ${EASING}, height ${ANIM_MS}ms ${EASING}`,
							}}
						>
							{hasSummaryText && (
								<div className="pt-1.5">
									<section
										ref={scrollRef}
										className="overflow-y-auto"
										aria-label="Compaction summary"
										style={{
											height: `${contentHeight}px`,
											maskImage:
												'linear-gradient(to bottom, transparent 0px, black 20px)',
											WebkitMaskImage:
												'linear-gradient(to bottom, transparent 0px, black 20px)',
										}}
										onMouseEnter={() => {
											hoveredRef.current = true;
										}}
										onMouseLeave={() => {
											hoveredRef.current = false;
										}}
									>
										<pre
											ref={contentMeasureRef}
											className="px-1 pt-2.5 pb-1 text-[12px] leading-relaxed text-foreground/70 font-mono whitespace-pre-wrap break-words"
										>
											{summaryText}
										</pre>
									</section>
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
							title={collapsedSummary}
						>
							Context compacted
							{collapsedSummary !== 'Context compacted' && (
								<>
									<span className="text-muted-foreground/45"> · </span>
									<span className="text-muted-foreground/80">
										{collapsedSummary}
									</span>
								</>
							)}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}