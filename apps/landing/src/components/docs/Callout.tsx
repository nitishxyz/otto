import type { ReactNode } from 'react';
import { cn } from '../neopop/cn';
import { ACCENT_EDGE, ACCENT_TEXT, type DocAccent } from './primitives';

export type CalloutKind = 'note' | 'tip' | 'warn';

const KIND: Record<CalloutKind, { accent: DocAccent; mark: string }> = {
	note: { accent: 'blue', mark: 'i' },
	tip: { accent: 'lime', mark: '★' },
	warn: { accent: 'coral', mark: '!' },
};

export interface CalloutProps {
	kind?: CalloutKind;
	title: string;
	children: ReactNode;
	className?: string;
}

/** Boxy aside for constraints, gotchas, and shortcuts. */
export function Callout({
	kind = 'note',
	title,
	children,
	className,
}: CalloutProps) {
	const { accent, mark } = KIND[kind];
	return (
		<aside
			className={cn(
				'my-6 rounded-[3px] np-edge np-shadow-sm border-l-[6px] bg-otto-surface px-4 py-3',
				ACCENT_EDGE[accent],
				className,
			)}
		>
			<p className="!mb-1 !mt-0 flex items-center gap-2 text-[13px] font-bold text-otto-text">
				<span className={cn('text-sm leading-none', ACCENT_TEXT[accent])}>
					{mark}
				</span>
				{title}
			</p>
			<div className="text-[13px] leading-relaxed text-otto-muted [&>p]:!mb-0 [&>p]:!mt-0 [&>p+p]:!mt-2">
				{children}
			</div>
		</aside>
	);
}
