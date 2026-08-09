import { memo } from 'react';
import { useIsCompactThread } from './threadDensity';

interface HiddenAssistantStepsRowProps {
	count: number;
	onShowAll: () => void;
	compact?: boolean;
}

/** Collapsed-middle affordance shown when a long turn is windowed. */
export const HiddenAssistantStepsRow = memo(function HiddenAssistantStepsRow({
	count,
	onShowAll,
	compact,
}: HiddenAssistantStepsRowProps) {
	const isCompactThread = useIsCompactThread();
	const isCompact = Boolean(compact || isCompactThread);

	return (
		<div
			className={`flex ${isCompact ? 'gap-1.5' : 'gap-3'} pb-1.5 relative max-w-full overflow-hidden`}
		>
			<div
				className={`flex-shrink-0 ${isCompact ? 'w-4' : 'w-6'} flex items-start justify-center relative`}
			>
				<div
					className="absolute left-1/2 top-0 bottom-[-0.375rem] -translate-x-1/2 w-[2px] bg-border z-0"
					aria-hidden="true"
				/>
			</div>

			<div className="flex-1 min-w-0">
				<button
					type="button"
					onClick={onShowAll}
					className="inline-flex max-w-full items-center gap-1.5 py-0.5 text-xs text-muted-foreground/75 transition-colors hover:text-foreground"
					title={`Show ${count} hidden assistant steps`}
				>
					<span className="text-muted-foreground/45">⋯</span>
					<span className="truncate leading-5">
						{count} earlier assistant steps collapsed
					</span>
					<span className="text-foreground/80 underline decoration-border underline-offset-2">
						Show
					</span>
				</button>
			</div>
		</div>
	);
});
