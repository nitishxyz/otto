import type { ReactNode } from 'react';
import { cn } from './cn';
import { NEO_RADIUS, TONE_EDGE, TONE_SURFACE, type NeoTone } from './tokens';

export type NeoBadgeSize = 'sm' | 'md';

const SIZE: Record<NeoBadgeSize, string> = {
	sm: 'h-5 px-1.5 text-[10px] gap-1',
	md: 'h-7 px-2.5 text-[11px] gap-1.5',
};

export interface NeoBadgeProps {
	children: ReactNode;
	tone?: NeoTone;
	size?: NeoBadgeSize;
	/** Outline-only rendering for lower-emphasis metadata. */
	outline?: boolean;
	/** Adds a small hard shadow. */
	elevated?: boolean;
	className?: string;
	title?: string;
}

/** Compact boxy label used for eyebrows, tags, and status chips. */
export function NeoBadge({
	children,
	tone = 'lime',
	size = 'md',
	outline = false,
	elevated = false,
	className,
	title,
}: NeoBadgeProps) {
	return (
		<span
			title={title}
			className={cn(
				'inline-flex items-center whitespace-nowrap font-semibold uppercase',
				'tracking-[0.12em] leading-none np-edge',
				NEO_RADIUS,
				SIZE[size],
				outline
					? 'bg-transparent text-otto-text'
					: cn(TONE_SURFACE[tone], TONE_EDGE[tone]),
				elevated && 'np-shadow-sm',
				className,
			)}
		>
			{children}
		</span>
	);
}
