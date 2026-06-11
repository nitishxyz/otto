import { memo, useMemo, useState } from 'react';
import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	RadioTower,
} from 'lucide-react';
import { parseOttoWakeup } from './otto-notice-parsing';
import { OttoTaskRow } from './OttoKickoffNotice';

export { isOttoWakeupMessage } from './otto-notice-parsing';

function subagentStatusClass(status: string): string {
	if (status === 'completed') return 'text-green-600 dark:text-green-400';
	if (status === 'failed') return 'text-red-600 dark:text-red-400';
	return 'text-muted-foreground';
}

interface OttoWakeupNoticeProps {
	content: string;
}

/**
 * Compact rendering for the automated `<otto_wakeup>` check-in message
 * dispatched into otto when a worker run finishes, instead of the raw tagged
 * payload. Header summarizes the worker run + goal progress; transcript and
 * sub-agent details are expandable. Errored runs get error styling.
 */
export const OttoWakeupNotice = memo(function OttoWakeupNotice({
	content,
}: OttoWakeupNoticeProps) {
	const data = useMemo(() => parseOttoWakeup(content), [content]);
	const [isExpanded, setIsExpanded] = useState(false);
	const taskCount = data.tasks.length;
	const completed = data.tasks.filter(
		(task) => task.status === 'completed',
	).length;
	const hasDetails =
		taskCount > 0 || data.transcript.length > 0 || data.subagents.length > 0;

	return (
		<div className="relative pb-4 pt-2">
			<div
				className={`rounded-xl border overflow-hidden ${
					data.errored
						? 'border-red-500/40 bg-red-500/5'
						: 'border-border bg-muted/30'
				}`}
			>
				<button
					type="button"
					onClick={() => hasDetails && setIsExpanded((value) => !value)}
					aria-expanded={isExpanded}
					className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${
						hasDetails
							? 'transition-colors hover:bg-muted/60 cursor-pointer'
							: 'cursor-default'
					}`}
				>
					<div
						className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
							data.errored ? 'bg-red-500/10' : 'bg-primary/10'
						}`}
					>
						<RadioTower
							className={`h-3.5 w-3.5 ${
								data.errored ? 'text-red-500' : 'text-primary'
							}`}
						/>
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
							Otto check-in
						</div>
						<div className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
							<span className="truncate">
								{data.workerAgent || 'worker'} run
							</span>
							{data.errored ? (
								<span className="flex shrink-0 items-center gap-1 text-red-600 dark:text-red-400">
									<AlertTriangle className="h-3.5 w-3.5" />
									errored
									{data.errorReason ? (
										<span className="max-w-[160px] truncate text-xs opacity-80">
											({data.errorReason})
										</span>
									) : null}
								</span>
							) : (
								<span className="flex shrink-0 items-center gap-1 text-green-600 dark:text-green-400">
									<CheckCircle2 className="h-3.5 w-3.5" />
									completed
								</span>
							)}
						</div>
					</div>
					{data.goalTitle ? (
						<span className="hidden min-w-0 max-w-[220px] truncate text-[11px] text-muted-foreground sm:block">
							{data.goalTitle}
						</span>
					) : null}
					{taskCount > 0 ? (
						<span className="shrink-0 text-[11px] text-muted-foreground">
							{completed}/{taskCount} done
						</span>
					) : null}
					{hasDetails ? (
						isExpanded ? (
							<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						) : (
							<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						)
					) : null}
				</button>

				{isExpanded ? (
					<div className="border-t border-border/60">
						{taskCount > 0 ? (
							<div className="divide-y divide-border/40 py-0.5">
								{data.tasks.map((task) => (
									<OttoTaskRow key={task.id || task.content} task={task} />
								))}
							</div>
						) : null}

						{data.subagents.length > 0 ? (
							<div className="border-t border-border/60 px-3 py-2">
								<div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
									Sub-agents
								</div>
								<div className="flex flex-col gap-1">
									{data.subagents.map((subagent, index) => (
										<div
											key={`${subagent.agent}-${index}`}
											className="flex items-center gap-1.5 text-xs"
										>
											<Bot className="h-3 w-3 shrink-0 text-muted-foreground" />
											<span className="font-medium text-foreground/80">
												{subagent.agent}
											</span>
											<span className={subagentStatusClass(subagent.status)}>
												{subagent.status}
											</span>
											{subagent.delivered !== undefined ? (
												<span className="text-[10px] text-muted-foreground/70">
													{subagent.delivered
														? 'delivered'
														: 'pending delivery'}
												</span>
											) : null}
										</div>
									))}
								</div>
							</div>
						) : null}

						{data.transcript.length > 0 ? (
							<div className="border-t border-border/60 px-3 py-2">
								<div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
									Recent worker transcript
								</div>
								<div className="max-h-48 overflow-y-auto rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
									{data.transcript.join('\n')}
								</div>
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
});
