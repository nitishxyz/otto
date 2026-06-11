import {
	memo,
	useCallback,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent,
} from 'react';
import {
	AlertTriangle,
	ArrowRight,
	ArrowUp,
	CheckCircle2,
	Circle,
	Clock,
	Play,
	Target,
	XCircle,
} from 'lucide-react';
import { useGoalsPanelStore } from '../../stores/goalsPanelStore';
import { usePanelWidthStore } from '../../stores/panelWidthStore';
import {
	useAddGoalTasks,
	useCreateSessionGoal,
	useSessionGoal,
	useStartGoal,
	useUpdateGoal,
	useUpdateGoalTask,
} from '../../hooks/useGoals';
import { useQueueState } from '../../hooks/useQueueState';
import type { GoalTask } from '../../lib/api-client';
import { SidebarHeader } from '../ui/SidebarHeader';
import { Textarea } from '../ui/Textarea';
import { ResizeHandle } from '../ui/ResizeHandle';
import { StableSpinner } from '../ui/StableSpinner';

const PANEL_KEY = 'goals';
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 320;
const MAX_WIDTH = 500;

interface GoalsSidebarProps {
	sessionId?: string;
}

export const GoalsSidebar = memo(function GoalsSidebar({
	sessionId,
}: GoalsSidebarProps) {
	const isExpanded = useGoalsPanelStore((state) => state.isExpanded);
	return isExpanded ? <GoalsSidebarContent sessionId={sessionId} /> : null;
});

function TaskIcon({ status }: { status: GoalTask['status'] }) {
	switch (status) {
		case 'completed':
			return (
				<CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
			);
		case 'done_pending':
			return (
				<Clock className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
			);
		case 'in_progress':
			return (
				<ArrowRight className="h-3.5 w-3.5 text-foreground flex-shrink-0 animate-pulse" />
			);
		case 'blocked':
			return (
				<AlertTriangle className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400 flex-shrink-0" />
			);
		case 'cancelled':
			return (
				<XCircle className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
			);
		default:
			return (
				<Circle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
			);
	}
}

function taskTextClass(status: GoalTask['status']) {
	if (status === 'completed') return 'text-muted-foreground line-through';
	if (status === 'cancelled') return 'text-muted-foreground/50 line-through';
	if (status === 'in_progress') return 'text-foreground';
	if (status === 'blocked') return 'text-orange-600 dark:text-orange-300';
	return 'text-foreground/80';
}

function taskStatusLabel(
	status: GoalTask['status'],
	isSessionRunning: boolean,
): string | null {
	if (status === 'done_pending') {
		return isSessionRunning ? 'claimed' : 'awaiting otto';
	}
	if (status === 'blocked') return 'blocked';
	return null;
}

interface GoalComposerProps {
	placeholder: string;
	onSubmit: (value: string) => void;
	disabled?: boolean;
	submitLabel: string;
}

/** Composer matching ChatInput's pill style: rounded-3xl card, borderless auto-growing textarea, round send button. */
function GoalComposer({
	placeholder,
	onSubmit,
	disabled,
	submitLabel,
}: GoalComposerProps) {
	const [value, setValue] = useState('');
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const shouldRefocusRef = useRef(false);

	useEffect(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${textarea.scrollHeight}px`;
	}, []);

	useEffect(() => {
		if (disabled || !shouldRefocusRef.current) return;
		shouldRefocusRef.current = false;
		requestAnimationFrame(() => {
			textareaRef.current?.focus();
		});
	}, [disabled]);

	const handleChange = useCallback(
		(event: React.ChangeEvent<HTMLTextAreaElement>) => {
			setValue(event.target.value);
			const textarea = event.target;
			textarea.style.height = 'auto';
			textarea.style.height = `${textarea.scrollHeight}px`;
		},
		[],
	);

	const submit = useCallback(() => {
		const trimmed = value.trim();
		if (!trimmed || disabled) return;
		shouldRefocusRef.current = true;
		onSubmit(trimmed);
		setValue('');
		requestAnimationFrame(() => {
			const textarea = textareaRef.current;
			if (textarea) {
				textarea.style.height = 'auto';
				textarea.focus();
			}
		});
	}, [value, disabled, onSubmit]);

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	};

	const canSubmit = Boolean(value.trim()) && !disabled;

	return (
		<div className="relative z-10 flex flex-col rounded-3xl p-1 transition-all touch-manipulation bg-card border border-border focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/40">
			<div className="flex items-end gap-1">
				<Textarea
					ref={textareaRef}
					value={value}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					disabled={disabled}
					rows={1}
					className="border-0 bg-transparent pl-3 pr-2 py-2 max-h-[200px] overflow-y-auto leading-normal resize-none scrollbar-hide text-base"
					style={{ height: '2.5rem' }}
				/>
				<button
					type="button"
					onClick={submit}
					disabled={!canSubmit}
					aria-label={submitLabel}
					title={submitLabel}
					className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors flex-shrink-0 touch-manipulation ${
						canSubmit
							? 'bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground'
							: 'bg-transparent text-muted-foreground'
					}`}
				>
					<ArrowUp className="w-4 h-4" />
				</button>
			</div>
		</div>
	);
}

const GoalsSidebarContent = memo(function GoalsSidebarContent({
	sessionId,
}: GoalsSidebarProps) {
	const collapseSidebar = useGoalsPanelStore((state) => state.collapseSidebar);
	const panelWidth = usePanelWidthStore(
		(s) => s.widths[PANEL_KEY] ?? DEFAULT_WIDTH,
	);

	const { data, isLoading } = useSessionGoal(sessionId);
	const createGoal = useCreateSessionGoal(sessionId);
	const updateGoal = useUpdateGoal(sessionId);
	const updateTask = useUpdateGoalTask(sessionId);
	const addTasks = useAddGoalTasks(sessionId);
	const startGoal = useStartGoal(sessionId);
	const queueState = useQueueState(sessionId);

	const goal = data?.goal ?? null;
	const tasks = goal?.tasks ?? [];
	const openTasks = tasks.filter(
		(task) => task.status !== 'completed' && task.status !== 'cancelled',
	);
	const canStart = Boolean(goal) && openTasks.length > 0;
	const isStarted = Boolean(goal?.startedAt);
	const isSessionRunning = queueState.isRunning;
	const hasPendingVerification = tasks.some(
		(task) => task.status === 'done_pending',
	);

	return (
		<div
			className="border-l border-sidebar-border sidebar-fade-in flex h-full relative"
			style={{ width: panelWidth }}
		>
			<ResizeHandle
				panelKey={PANEL_KEY}
				side="right"
				minWidth={MIN_WIDTH}
				maxWidth={MAX_WIDTH}
				defaultWidth={DEFAULT_WIDTH}
			/>
			<div className="flex-1 flex flex-col h-full min-w-0">
				<SidebarHeader
					icon={<Target className="size-[15px]" />}
					title="Goals"
					onClose={collapseSidebar}
				/>

				{!sessionId ? (
					<div className="px-4 py-8 text-center text-sm text-muted-foreground">
						Open a session to manage its goal.
					</div>
				) : isLoading ? (
					<div className="px-4 py-8 text-center text-sm text-muted-foreground">
						Loading goal...
					</div>
				) : !goal ? (
					<div className="flex flex-1 min-h-0 flex-col items-center justify-center px-4">
						<div className="w-full max-w-sm space-y-4 -mt-12">
							<div className="flex flex-col items-center text-center space-y-2">
								<div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
									<Target className="h-5 w-5 text-primary" />
								</div>
								<div className="text-sm font-medium text-foreground">
									Set a goal
								</div>
								<p className="text-xs leading-relaxed text-muted-foreground">
									Title first, tasks next.
								</p>
							</div>
							<GoalComposer
								placeholder="Goal title..."
								submitLabel="Create goal"
								onSubmit={(title) => createGoal.mutate({ title })}
								disabled={createGoal.isPending}
							/>
						</div>
					</div>
				) : (
					<div className="flex flex-col flex-1 min-h-0">
						<div className="border-b border-border bg-muted/30 px-3 py-2 shrink-0">
							<div className="flex items-center justify-between mb-0.5">
								<span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
									Goal
								</span>
								{goal.status !== 'active' ? (
									<span
										className={`text-[10px] font-medium uppercase tracking-wider ${
											goal.status === 'completed'
												? 'text-green-600 dark:text-green-400'
												: 'text-muted-foreground'
										}`}
									>
										{goal.status}
									</span>
								) : null}
							</div>
							<div className="text-[13px] font-medium text-foreground leading-snug">
								{goal.title}
							</div>
						</div>

						<div className="flex-1 overflow-y-auto min-h-0">
							<div>
								{tasks.map((task) => {
									const statusLabel = taskStatusLabel(
										task.status,
										isSessionRunning,
									);
									const isActive = task.status === 'in_progress';
									return (
										<div
											key={task.id}
											className={`group px-3 py-1.5 ${
												isActive
													? 'bg-primary/5 border-l-2 border-primary pl-2.5'
													: ''
											}`}
										>
											<div className="flex items-start gap-1.5 min-w-0">
												<div className="mt-[3px]">
													<TaskIcon status={task.status} />
												</div>
												<div className="min-w-0 flex-1">
													<div
														className={`text-[12px] leading-snug ${taskTextClass(task.status)}`}
													>
														{task.content}
														{statusLabel ? (
															<span className="ml-1.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
																{statusLabel}
															</span>
														) : null}
													</div>
													{task.note ? (
														<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80 line-clamp-2">
															{task.note}
														</p>
													) : null}
												</div>
												{task.status !== 'completed' &&
													task.status !== 'cancelled' && (
														<button
															type="button"
															onClick={() =>
																updateTask.mutate({
																	goalId: goal.id,
																	taskId: task.id,
																	status: 'cancelled',
																})
															}
															disabled={updateTask.isPending}
															aria-label="Cancel task"
															title="Cancel task"
															className="mt-[3px] opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity disabled:opacity-50 flex-shrink-0"
														>
															<XCircle className="h-3 w-3" />
														</button>
													)}
											</div>
										</div>
									);
								})}
								{tasks.length === 0 ? (
									<p className="px-3 py-5 text-center text-xs text-muted-foreground">
										No tasks yet. Add the steps below.
									</p>
								) : null}
							</div>

							{goal.status === 'active' && (
								<div className="px-3 py-2">
									{isStarted ? (
										<div className="flex items-center justify-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground">
											<StableSpinner size="sm" title="Goal in progress" />
											{hasPendingVerification
												? isSessionRunning
													? 'Waiting for run to finish'
													: 'Otto is verifying claims'
												: 'In progress'}
										</div>
									) : (
										<>
											<button
												type="button"
												onClick={() => startGoal.mutate({ goalId: goal.id })}
												disabled={!canStart || startGoal.isPending}
												className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
													canStart && !startGoal.isPending
														? 'bg-primary text-primary-foreground hover:bg-primary/90'
														: 'bg-muted text-muted-foreground cursor-not-allowed'
												}`}
												title="The agent works through all open tasks in order; otto keeps it going until the goal is done"
											>
												{startGoal.isPending ? (
													<StableSpinner size="sm" title="Starting goal" />
												) : (
													<Play className="h-3.5 w-3.5" />
												)}
												{startGoal.isPending ? 'Starting...' : 'Start Goal'}
											</button>
											<p className="mt-1 text-center text-[10px] text-muted-foreground">
												{canStart
													? `Runs through all ${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}`
													: 'Add at least one task to start'}
											</p>
										</>
									)}
								</div>
							)}
						</div>

						<div className="shrink-0 px-3 pb-3 pt-1 space-y-1.5">
							<GoalComposer
								placeholder="Add a task..."
								submitLabel="Add task"
								onSubmit={(content) =>
									addTasks.mutate({ goalId: goal.id, tasks: [content] })
								}
								disabled={addTasks.isPending}
							/>
							{goal.status === 'active' ? (
								<button
									type="button"
									onClick={() =>
										updateGoal.mutate({
											goalId: goal.id,
											status: 'abandoned',
										})
									}
									disabled={updateGoal.isPending}
									className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1 disabled:opacity-50"
								>
									Abandon goal
								</button>
							) : null}
						</div>
					</div>
				)}
			</div>
		</div>
	);
});
