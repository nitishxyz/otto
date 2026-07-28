import { cn } from '../neopop/cn';
import { RESET_LIST, RESET_TEXT } from './primitives';

export interface Step {
	title: string;
	desc?: string;
	/** Optional mono detail, e.g. a route or file path. */
	code?: string;
}

export interface StepsProps {
	items: Step[];
	className?: string;
}

/** Numbered sequence with hard-edged index chips. */
export function Steps({ items, className }: StepsProps) {
	return (
		<ol className={cn('my-6 space-y-2', RESET_LIST, className)}>
			{items.map((step, index) => (
				<li
					key={step.title}
					className="flex gap-3 rounded-[3px] np-edge np-shadow-sm bg-otto-surface px-3 py-2.5"
				>
					<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] np-edge bg-np-blue text-[11px] font-bold text-np-blue-on">
						{String(index + 1).padStart(2, '0')}
					</span>
					<div className="min-w-0">
						<p
							className={cn('text-[13px] font-bold text-otto-text', RESET_TEXT)}
						>
							{step.title}
						</p>
						{step.desc ? (
							<p
								className={cn(
									'mt-0.5 text-[12px] leading-relaxed text-otto-muted',
									RESET_TEXT,
								)}
							>
								{step.desc}
							</p>
						) : null}
						{step.code ? (
							<p
								className={cn(
									'mt-1.5 break-all text-[11px] text-otto-dim',
									RESET_TEXT,
								)}
							>
								<code>{step.code}</code>
							</p>
						) : null}
					</div>
				</li>
			))}
		</ol>
	);
}
