import { memo, useMemo } from 'react';
import { Play, Target } from 'lucide-react';

export const GOAL_START_TAG = '<goal_start';

export function isGoalStartMessage(content: string): boolean {
	return content.trimStart().startsWith(GOAL_START_TAG);
}

function parseGoalStart(content: string): { title: string; taskCount: number } {
	const title = /<title>([\s\S]*?)<\/title>/.exec(content)?.[1]?.trim() ?? '';
	const tasksBlock =
		/<tasks>([\s\S]*?)<\/tasks>/.exec(content)?.[1]?.trim() ?? '';
	const taskCount = tasksBlock
		? tasksBlock.split('\n').filter((line) => line.trim().startsWith('-'))
				.length
		: 0;
	return { title, taskCount };
}

interface GoalStartNoticeProps {
	content: string;
}

/**
 * Compact rendering for the automated goal kickoff message, shown instead of
 * the raw tagged payload.
 */
export const GoalStartNotice = memo(function GoalStartNotice({
	content,
}: GoalStartNoticeProps) {
	const { title, taskCount } = useMemo(
		() => parseGoalStart(content),
		[content],
	);

	return (
		<div className="relative pb-4 pt-2">
			<div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
				<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
					<Play className="h-3.5 w-3.5 text-primary" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						<Target className="h-3 w-3" />
						Goal started
					</div>
					<div className="truncate text-sm text-foreground">
						{title || 'Untitled goal'}
					</div>
				</div>
				{taskCount > 0 ? (
					<span className="shrink-0 text-[11px] text-muted-foreground">
						{taskCount} task{taskCount === 1 ? '' : 's'}
					</span>
				) : null}
			</div>
		</div>
	);
});
