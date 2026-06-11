import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	Circle,
	XCircle,
} from 'lucide-react';
import type { GenericRendererProps } from './types';
import { formatDuration } from './utils';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolHeaderError,
} from './shared';

type GoalToolTask = {
	id: string;
	position: number;
	content: string;
	status: string;
	note?: string;
};

function taskIcon(status: string) {
	switch (status) {
		case 'completed':
			return <CheckCircle2 className="h-3 w-3 text-green-500" />;
		case 'in_progress':
			return <ArrowRight className="h-3 w-3 text-foreground/70" />;
		case 'blocked':
			return <AlertTriangle className="h-3 w-3 text-orange-500" />;
		case 'cancelled':
			return <XCircle className="h-3 w-3 text-muted-foreground/50" />;
		default:
			return <Circle className="h-3 w-3 text-muted-foreground" />;
	}
}

function taskClass(status: string): string {
	if (status === 'completed' || status === 'cancelled')
		return 'text-foreground/40 line-through';
	if (status === 'blocked') return 'text-orange-600 dark:text-orange-300';
	return 'text-foreground/70';
}

export function GoalToolRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
	toolName,
}: GenericRendererProps) {
	const result = (contentJson.result || {}) as Record<string, unknown>;
	const timeStr = formatDuration(toolDurationMs);
	const hasError = result.ok === false;

	const goal = (result.goal ?? null) as {
		title?: string;
		status?: string;
	} | null;
	const tasks = Array.isArray(result.tasks)
		? (result.tasks as GoalToolTask[])
		: [];
	const changes = Array.isArray(result.changes)
		? (result.changes as string[])
		: [];
	const openCount = tasks.filter(
		(t) => t.status !== 'completed' && t.status !== 'cancelled',
	).length;

	const headline = hasError
		? String(result.error ?? 'error')
		: goal
			? goal.title
			: 'no goal';

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName={toolName ?? 'goal'}
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="cyan"
				canExpand={tasks.length > 0 || changes.length > 0}
			>
				{!compact && (
					<>
						<ToolHeaderSeparator />
						<span className="max-w-[280px] truncate font-mono text-[11px] text-foreground/60">
							{headline}
						</span>
					</>
				)}
				{!hasError && !compact && tasks.length > 0 && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderSuccess>
							{tasks.length - openCount}/{tasks.length} done
						</ToolHeaderSuccess>
					</>
				)}
				{hasError && !compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderError>error</ToolHeaderError>
					</>
				)}
				{!compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{isExpanded && (
				<div className="mt-1.5 ml-5 flex flex-col gap-1">
					{changes.length > 0 && (
						<div className="flex flex-col gap-0.5">
							{changes.map((change) => (
								<div
									key={change}
									className="text-[11px] text-cyan-700 dark:text-cyan-300"
								>
									{change}
								</div>
							))}
						</div>
					)}
					{tasks.map((task) => (
						<div key={task.id} className="flex items-start gap-1.5 text-[11px]">
							<span className="mt-0.5 shrink-0">{taskIcon(task.status)}</span>
							<span className={taskClass(task.status)}>
								{task.content}
								{task.note ? (
									<span className="text-muted-foreground"> — {task.note}</span>
								) : null}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
