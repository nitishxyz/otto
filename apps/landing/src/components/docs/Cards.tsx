import type { ReactNode } from 'react';
import { cn } from '../neopop/cn';
import {
	ACCENT_FILL,
	RESET_LIST,
	RESET_TEXT,
	type DocAccent,
} from './primitives';

export interface CardGridProps {
	children: ReactNode;
	cols?: 2 | 3;
	className?: string;
}

const COLS: Record<2 | 3, string> = {
	2: 'sm:grid-cols-2',
	3: 'sm:grid-cols-2 lg:grid-cols-3',
};

export function CardGrid({ children, cols = 2, className }: CardGridProps) {
	return (
		<div className={cn('my-6 grid gap-3', COLS[cols], className)}>
			{children}
		</div>
	);
}

export interface DocCardProps {
	title: string;
	/** Uppercase micro-label, e.g. `apps/cli`. */
	kicker?: string;
	desc?: string;
	items?: string[];
	accent?: DocAccent;
	href?: string;
	/** Small mono line pinned to the bottom, e.g. a command. */
	footnote?: string;
}

/** Link-or-static card used for surface/package overviews. */
export function DocCard({
	title,
	kicker,
	desc,
	items,
	accent = 'neutral',
	href,
	footnote,
}: DocCardProps) {
	const body = (
		<>
			<div className="flex items-center gap-2">
				<span className={cn('h-2.5 w-2.5 shrink-0', ACCENT_FILL[accent])} />
				{kicker ? (
					<span className="np-eyebrow truncate text-otto-dim">{kicker}</span>
				) : null}
			</div>
			<p
				className={cn('mt-2 text-[14px] font-bold text-otto-text', RESET_TEXT)}
			>
				{title}
			</p>
			{desc ? (
				<p
					className={cn(
						'mt-1.5 text-[12px] leading-relaxed text-otto-muted',
						RESET_TEXT,
					)}
				>
					{desc}
				</p>
			) : null}
			{items?.length ? (
				<ul className={cn('mt-2.5 space-y-1', RESET_LIST)}>
					{items.map((item) => (
						<li
							key={item}
							className="flex gap-1.5 text-[11px] leading-snug text-otto-dim"
						>
							<span className="text-otto-border-light">▪</span>
							<span>{item}</span>
						</li>
					))}
				</ul>
			) : null}
			{footnote ? (
				<p
					className={cn(
						'mt-3 border-t-2 border-otto-border pt-2 text-[11px] text-otto-dim',
						RESET_TEXT,
					)}
				>
					{footnote}
				</p>
			) : null}
		</>
	);

	const shell =
		'flex h-full flex-col rounded-[3px] np-edge np-shadow-sm bg-otto-surface px-3.5 py-3';

	if (href) {
		return (
			<a
				href={href}
				className={cn(shell, 'np-lift !no-underline hover:bg-otto-card')}
			>
				{body}
			</a>
		);
	}
	return <div className={shell}>{body}</div>;
}
