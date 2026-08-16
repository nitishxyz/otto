import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useIsCompactThread } from './threadDensity';

interface ShowWorkToggleProps {
	expanded: boolean;
	onToggle: () => void;
	compact?: boolean;
}

/**
 * Horizontal-rule control that reveals or hides an older turn's tool work.
 */
export const ShowWorkToggle = memo(function ShowWorkToggle({
	expanded,
	onToggle,
	compact,
}: ShowWorkToggleProps) {
	const isCompactThread = useIsCompactThread();
	const isCompact = Boolean(compact || isCompactThread);

	return (
		<div
			className={`flex items-center ${isCompact ? 'gap-2 py-2' : 'gap-3 py-3.5'}`}
		>
			<div className="h-px min-w-4 flex-1 bg-border" />
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={expanded}
				className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground/80 transition-colors hover:text-foreground"
			>
				{expanded ? 'Hide Work' : 'Show Work'}
				<ChevronRight
					className={`h-3.5 w-3.5 transition-transform ${
						expanded ? 'rotate-90' : ''
					}`}
				/>
			</button>
			<div className="h-px min-w-4 flex-1 bg-border" />
		</div>
	);
});
