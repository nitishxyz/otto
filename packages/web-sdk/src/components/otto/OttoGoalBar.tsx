import { memo, useCallback, useState, type KeyboardEvent } from 'react';
import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Circle,
	ExternalLink,
	Play,
	Plus,
	Target,
	Trash2,
	XCircle,
} from 'lucide-react';
import {
	useAddProjectGoalTasks,
	useDeleteProjectGoalTask,
	useProjectGoals,
	useStartGoal,
} from '../../hooks/useGoals';
import { useSubagentViewerStore } from '../../stores/subagentViewerStore';
import { toast } from '../../stores/toastStore';
import type { Goal, GoalStatus, GoalTask } from '../../lib/api-client';
import { StableSpinner } from '../ui/StableSpinner';
import {
	INPUT_BAR_ATTACHED_CARD_CLASS,
	INPUT_BAR_GROUP_CLASS,
	inputBarWrapperProps,
} from '../chat/input-bar-chrome';

function TaskIcon({ status }: { status: GoalTask['status'] }) {
	switch (status) {
		case 'completed':
			return (
				<CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-green-600 dark:text-green-400" />
			);
		case 'in_progress':
			return (
				<ArrowRight className="h-3.5 w-3.5 flex-shrink-0 animate-pulse text-foreground" />
			);
		case 'blocked':
			return (
				<AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-orange-600 dark:text-orange-400" />
			);
		case 'cancelled':
			return (
				<XCircle className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50" />
			);
		default:
			return (
				<Circle className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
			);
	}
}

function taskTextClass(status: GoalTask['status']): string {
	if (status === 'completed') return 'text-muted-foreground line-through';
	if (status === 'cancelled') return 'text-muted-foreground/50 line-through';
	if (status === 'in_progress') return 'text-foreground';
	if (status === 'blocked') return 'text-orange-600 dark:text-orange-300';
	return 'text-muted-foreground/80';
}

function pickVisibleTask(tasks: GoalTask[]): GoalTask | undefined {
	return (
		tasks.find((task) => task.status === 'in_progress') ??
		tasks.find((task) => task.status === 'pending') ??
		tasks[0]
	);
}

/**
 * Resolves the goal shown for a session. Multiple goals can point at the
 * same otto session; prefer active goals, then the most recently created,
 * so the choice is deterministic instead of array-order dependent.
 */
function pickSessionGoal(
	goals: Goal[] | undefined,
	sessionId: string,
): Goal | null {
	if (!goals) return null;
	const matches = goals.filter((g) => g.ottoSessionId === sessionId);
	if (matches.length === 0) return null;
	const active = matches.filter((g) => g.status === 'active');
	const pool = active.length > 0 ? active : matches;
	return pool.reduce((latest, g) =>
		g.createdAt > latest.createdAt ? g : latest,
	);
}

function GoalStatusBadge({ status }: { status: GoalStatus }) {
	if (status === 'completed') {
		return (
			<span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
				<CheckCircle2 className="h-3 w-3" />
				Completed
			</span>
		);
	}
	if (status === 'abandoned') {
		return (
			<span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
				<XCircle className="h-3 w-3" />
				Abandoned
			</span>
		);
	}
	return null;
}

interface TaskRowProps {
	task: GoalTask;
	onOpenWorker: (task: GoalTask) => void;
	onDelete: (task: GoalTask) => void;
	deleteDisabled: boolean;
}

const TaskRow = memo(function TaskRow({
	task,
	onOpenWorker,
	onDelete,
	deleteDisabled,
}: TaskRowProps) {
	// In-progress tasks cannot be deleted (server returns 409); hide the
	// affordance and let users cancel via otto instead.
	const canDelete = task.status !== 'in_progress';
	const isCurrent = task.status === 'in_progress';
	return (
		<div
			className={`group flex items-start gap-2 min-w-0 px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-200 ${
				isCurrent ? 'bg-primary/5 border-l-2 border-primary/70 pl-2.5' : ''
			}`}
		>
			<div className="mt-[1px]">
				<TaskIcon status={task.status} />
			</div>
			<div className="min-w-0 flex-1">
				<div className={`text-xs leading-snug ${taskTextClass(task.status)}`}>
					{task.content}
					<span className="ml-1.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
						{task.status.replace('_', ' ')}
					</span>
				</div>
				{task.note ? (
					<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">
						{task.note}
					</p>
				) : null}
			</div>
			{task.sessionId ? (
				<button
					type="button"
					onClick={() => onOpenWorker(task)}
					className="flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					title="Open worker session transcript"
				>
					<ExternalLink className="h-3 w-3" />
					worker
				</button>
			) : null}
			{canDelete ? (
				<button
					type="button"
					onClick={() => onDelete(task)}
					disabled={deleteDisabled}
					className="mt-[1px] flex-shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
					aria-label="Delete task"
					title="Delete task"
				>
					<Trash2 className="h-3 w-3" />
				</button>
			) : null}
		</div>
	);
});

interface AddTaskComposerProps {
	goalId: string;
}

/** Inline add-task input at the bottom of the expanded goals bar. */
const AddTaskComposer = memo(function AddTaskComposer({
	goalId,
}: AddTaskComposerProps) {
	const [value, setValue] = useState('');
	const addTasks = useAddProjectGoalTasks();

	const submit = useCallback(() => {
		const content = value.trim();
		if (!content || addTasks.isPending) return;
		addTasks.mutate(
			{ goalId, tasks: [content] },
			{
				onSuccess: () => setValue(''),
				onError: (error) =>
					toast.error(
						error instanceof Error ? error.message : 'Failed to add task',
					),
			},
		);
	}, [value, addTasks, goalId]);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				submit();
			}
		},
		[submit],
	);

	const canSubmit = Boolean(value.trim()) && !addTasks.isPending;

	return (
		<div className="flex items-center gap-1.5 px-3 py-2">
			<input
				type="text"
				value={value}
				onChange={(event) => setValue(event.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Add a task..."
				disabled={addTasks.isPending}
				className="h-7 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary/60 focus:outline-none disabled:opacity-60"
			/>
			<button
				type="button"
				onClick={submit}
				disabled={!canSubmit}
				className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
					canSubmit
						? 'bg-primary text-primary-foreground hover:bg-primary/90'
						: 'text-muted-foreground'
				}`}
				aria-label="Add task"
				title="Add task"
			>
				{addTasks.isPending ? (
					<StableSpinner size="sm" title="Adding task" />
				) : (
					<Plus className="h-3.5 w-3.5" />
				)}
			</button>
		</div>
	);
});

interface OttoGoalBarContentProps {
	goal: Goal;
}

const OttoGoalBarContent = memo(function OttoGoalBarContent({
	goal,
}: OttoGoalBarContentProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const openWorker = useSubagentViewerStore((state) => state.open);
	const deleteTask = useDeleteProjectGoalTask();
	const startGoal = useStartGoal(goal.ottoSessionId ?? undefined);

	const handleOpenWorker = useCallback(
		(task: GoalTask) => {
			if (!task.sessionId) return;
			openWorker({
				childSessionId: task.sessionId,
				agent: 'worker',
				task: task.content,
			});
		},
		[openWorker],
	);

	const handleDelete = useCallback(
		(task: GoalTask) => {
			deleteTask.mutate(
				{ goalId: task.goalId, taskId: task.id },
				{
					onError: (error) => {
						const message =
							error instanceof Error ? error.message : 'Failed to delete task';
						toast.error(
							/in[_ ]progress/i.test(message)
								? 'Task is in progress and cannot be deleted — ask otto to cancel it instead.'
								: message,
						);
					},
				},
			);
		},
		[deleteTask],
	);

	const tasks = goal.tasks;
	const total = tasks.length;
	const completed = tasks.filter((task) => task.status === 'completed').length;
	const openTasks = tasks.filter(
		(task) => task.status !== 'completed' && task.status !== 'cancelled',
	);
	const isActive = goal.status === 'active';
	const summaryTask =
		isActive && openTasks.length > 0 ? pickVisibleTask(tasks) : undefined;
	const showStart =
		goal.status === 'active' &&
		!goal.startedAt &&
		openTasks.length > 0 &&
		tasks.every(
			(task) => task.status === 'pending' || task.status === 'cancelled',
		);

	return (
		<div
			className={`border border-border bg-card overflow-hidden ${INPUT_BAR_ATTACHED_CARD_CLASS}`}
		>
			<div
				className="grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out"
				style={{
					gridTemplateRows: isExpanded ? '0fr' : '1fr',
					opacity: isExpanded ? 0 : 1,
					visibility: isExpanded ? 'hidden' : 'inherit',
				}}
			>
				<div className="overflow-hidden">
					<button
						type="button"
						aria-expanded={isExpanded}
						aria-label="Expand goal tasks"
						onClick={() => setIsExpanded(true)}
						className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted cursor-pointer"
					>
						<Target className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
						<span className="text-xs font-medium text-foreground flex-shrink-0">
							Goal
						</span>
						<span className="h-3 w-px bg-border flex-shrink-0" />
						<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
							{summaryTask ? summaryTask.content : goal.title}
						</span>
						<GoalStatusBadge status={goal.status} />
						<span className="text-[11px] text-muted-foreground ml-auto flex-shrink-0">
							{completed}/{total} done
						</span>
						<ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
					</button>
				</div>
			</div>

			<div
				className="grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out"
				style={{
					gridTemplateRows: isExpanded ? '1fr' : '0fr',
					opacity: isExpanded ? 1 : 0,
					visibility: isExpanded ? 'inherit' : 'hidden',
				}}
			>
				<div className="overflow-hidden">
					<div className="flex items-center gap-2 border-b border-border pr-2">
						<button
							type="button"
							aria-expanded={isExpanded}
							aria-label="Collapse goal tasks"
							onClick={() => setIsExpanded(false)}
							className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted"
						>
							<Target className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
							<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
								{goal.title}
							</span>
							<GoalStatusBadge status={goal.status} />
							<span className="text-[11px] text-muted-foreground ml-auto flex-shrink-0">
								{completed}/{total} done
							</span>
							<ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
						</button>
						{showStart ? (
							<button
								type="button"
								onClick={() =>
									startGoal.mutate(
										{ goalId: goal.id },
										{
											onError: (error) =>
												toast.error(
													error instanceof Error
														? error.message
														: 'Failed to start goal',
												),
										},
									)
								}
								disabled={startGoal.isPending}
								className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
								title="Dispatch otto to work this goal"
							>
								{startGoal.isPending ? (
									<StableSpinner size="sm" title="Starting goal" />
								) : (
									<Play className="h-3 w-3" />
								)}
								Start
							</button>
						) : null}
					</div>
					<div className="max-h-64 overflow-y-auto divide-y divide-border">
						{tasks.length === 0 ? (
							<p className="px-3 py-2 text-xs text-muted-foreground">
								{isActive
									? 'No tasks yet. Ask otto to plan this goal, or add tasks below.'
									: 'No tasks were added to this goal.'}
							</p>
						) : (
							tasks.map((task) => (
								<TaskRow
									key={task.id}
									task={task}
									onOpenWorker={handleOpenWorker}
									onDelete={handleDelete}
									deleteDisabled={deleteTask.isPending}
								/>
							))
						)}
						{goal.status === 'active' ? (
							<AddTaskComposer goalId={goal.id} />
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
});

interface OttoGoalBarProps {
	sessionId: string;
}

/**
 * Collapsible goals bar attached above the chat input of otto sessions, in
 * the exact InputTodosBar interaction pattern. Collapsed: compact summary
 * ("Goal | <current task> — n/m done"). Expanded: full task queue with
 * add/remove affordances and worker transcript links. Resolves the goal
 * attached to this session (goal.ottoSessionId === sessionId; when several
 * match, the most recently created active goal wins) and hides itself with
 * the grid-rows animation when no goal exists yet or while goals are still
 * loading. A failed goals fetch shows a subtle inline notice instead of
 * silently hiding. Only mount this for otto sessions — it owns the project
 * goals query.
 */
export const OttoGoalBar = memo(function OttoGoalBar({
	sessionId,
}: OttoGoalBarProps) {
	const { data, isError } = useProjectGoals();
	const goal = pickSessionGoal(data?.goals, sessionId);
	const showError = isError && !goal;

	return (
		<div
			className={`${INPUT_BAR_GROUP_CLASS} grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out`}
			{...inputBarWrapperProps(Boolean(goal || showError))}
			style={{
				gridTemplateRows: goal || showError ? '1fr' : '0fr',
				opacity: goal || showError ? 1 : 0,
				visibility: goal || showError ? 'visible' : 'hidden',
			}}
		>
			<div className="overflow-hidden">
				{goal ? (
					<OttoGoalBarContent goal={goal} />
				) : showError ? (
					<div
						className={`border border-border bg-card overflow-hidden ${INPUT_BAR_ATTACHED_CARD_CLASS}`}
					>
						<p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
							<AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-orange-600 dark:text-orange-400" />
							Could not load goals — retrying automatically.
						</p>
					</div>
				) : null}
			</div>
		</div>
	);
});
