import type { RendererProps } from './types';
import { formatDuration } from './utils';

export function FinishRenderer({ toolDurationMs }: RendererProps) {
	const timeStr = formatDuration(toolDurationMs);

	return (
		<div className="text-[12px]">
			<div className="flex items-center gap-2">
				<span className="font-medium text-emerald-700 dark:text-emerald-300">
					Done
				</span>
				{timeStr && (
					<>
						<span className="text-muted-foreground/70">·</span>
						<span className="text-muted-foreground/80">{timeStr}</span>
					</>
				)}
			</div>
		</div>
	);
}
