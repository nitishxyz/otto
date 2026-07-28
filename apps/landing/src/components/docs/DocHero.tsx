import { cn } from '../neopop/cn';
import { RESET_LIST } from './primitives';

export interface DocHeroProps {
	/** Uppercase micro-label above the title. */
	eyebrow: string;
	title: string;
	lede: string;
	/** Short tags rendered as boxy chips under the lede. */
	tags?: string[];
	className?: string;
}

/** Consistent docs page opener: eyebrow, title, lede, optional tag row. */
export function DocHero({
	eyebrow,
	title,
	lede,
	tags,
	className,
}: DocHeroProps) {
	return (
		<header className={cn('mb-8', className)}>
			<p className="np-eyebrow mb-3 text-otto-dim">{eyebrow}</p>
			<h1 className="np-title !mb-3">{title}</h1>
			<p className="max-w-2xl text-sm leading-relaxed text-otto-muted">
				{lede}
			</p>
			{tags?.length ? (
				<ul className={cn('mt-4 flex flex-wrap gap-2', RESET_LIST)}>
					{tags.map((tag) => (
						<li
							key={tag}
							className="rounded-[3px] np-edge bg-otto-surface px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-otto-muted"
						>
							{tag}
						</li>
					))}
				</ul>
			) : null}
		</header>
	);
}
