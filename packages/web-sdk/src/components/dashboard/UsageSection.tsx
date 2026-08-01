import type { ReactNode } from 'react';
import { cn, NEO_EYEBROW, NeoPanel, type NeoElevation } from './neopop';

export interface UsageSectionProps {
	title: ReactNode;
	subtitle?: ReactNode;
	/** Right-aligned controls: segmented tabs, sort pickers, counters. */
	actions?: ReactNode;
	elevation?: NeoElevation;
	className?: string;
	bodyClassName?: string;
	children: ReactNode;
}

/**
 * Standard panel shell: hard-edged surface, a ruled header carrying the
 * eyebrow, and a slot for per-panel controls so each block stays
 * self-contained.
 */
export function UsageSection({
	title,
	subtitle,
	actions,
	elevation = 'none',
	className,
	bodyClassName,
	children,
}: UsageSectionProps) {
	return (
		<NeoPanel
			as="section"
			elevation={elevation}
			className={cn('flex min-w-0 flex-col', className)}
		>
			<header className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[rgb(var(--np-edge))] px-4 py-3.5">
				<div className="min-w-0">
					<h3 className={cn(NEO_EYEBROW, 'text-muted-foreground')}>{title}</h3>
					{subtitle && (
						<p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/80">
							{subtitle}
						</p>
					)}
				</div>
				{actions}
			</header>
			<div className={cn('min-w-0 flex-1 p-4', bodyClassName)}>{children}</div>
		</NeoPanel>
	);
}
