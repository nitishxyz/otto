import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Play, Target } from 'lucide-react';
import { parseOttoKickoff, type OttoNoticeTask } from './otto-notice-parsing';

export { isOttoKickoffMessage } from './otto-notice-parsing';

function taskChipClass(status: string): string {
	switch (status) {
		case 'completed':
			return 'bg-green-500/10 text-green-600 dark:text-green-400';
		case 'in_progress':
			return 'bg-primary/10 text-primary';
		case 'blocked':
			return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
		case 'cancelled':
			return 'bg-muted text-muted-foreground/60';
		default:
			return 'bg-muted text-muted-foreground';
	}
}

export const OttoTaskRow = memo(function OttoTaskRow({
	task,
}: {
	task: OttoNoticeTask;
}) {
	return (
		<div className="flex items-start gap-2 px-3 py-1.5 min-w-0">
			<span
				className={`mt-[1px] shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${taskChipClass(task.status)}`}
			>
				{task.status.replace('_', ' ')}
			</span>
			<div className="min-w-0 flex-1">
				<div
					className={`text-xs leading-snug ${
						task.status === 'completed' || task.status === 'cancelled'
							? 'text-muted-foreground line-through'
							: 'text-foreground/85'
					}`}
				>
					{task.content}
				</div>
				{task.note ? (
					<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">
						{task.note}
					</p>
				) : null}
			</div>
		</div>
	);
});

interface OttoKickoffNoticeProps {
	content: string;
}

/**
 * Compact rendering for the automated `<otto_kickoff>` message dispatched
 * when a goal is started, instead of the raw tagged payload. Collapsible
 * task list; model-facing instructions stay hidden.
 */
export const OttoKickoffNotice = memo(function OttoKickoffNotice({
	content,
}: OttoKickoffNoticeProps) {
	const data = useMemo(() => parseOttoKickoff(content), [content]);
	const [isExpanded, setIsExpanded] = useState(false);
	const taskCount = data.tasks.length;
	const completed = data.tasks.filter(
		(task) => task.status === 'completed',
	).length;

	return (
		<div className="relative pb-4 pt-2">
			<div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
				<button
					type="button"
					onClick={() => taskCount > 0 && setIsExpanded((value) => !value)}
					aria-expanded={isExpanded}
					className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${
						taskCount > 0
							? 'transition-colors hover:bg-muted/60 cursor-pointer'
							: 'cursor-default'
					}`}
				>
					<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
						<Play className="h-3.5 w-3.5 text-primary" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
							<Target className="h-3 w-3" />
							Goal started
						</div>
						<div className="truncate text-sm text-foreground">
							{data.title || 'Untitled goal'}
						</div>
					</div>
					{taskCount > 0 ? (
						<>
							<span className="shrink-0 text-[11px] text-muted-foreground">
								{completed}/{taskCount} task{taskCount === 1 ? '' : 's'}
							</span>
							{isExpanded ? (
								<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							) : (
								<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							)}
						</>
					) : (
						<span className="shrink-0 text-[11px] text-muted-foreground">
							no tasks yet
						</span>
					)}
				</button>
				{isExpanded && taskCount > 0 ? (
					<div className="border-t border-border/60 divide-y divide-border/40 py-0.5">
						{data.tasks.map((task) => (
							<OttoTaskRow key={task.id || task.content} task={task} />
						))}
					</div>
				) : null}
			</div>
		</div>
	);
});
