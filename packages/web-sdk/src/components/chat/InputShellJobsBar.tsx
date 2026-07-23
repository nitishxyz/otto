import {
	memo,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Square,
	Terminal,
	XCircle,
} from 'lucide-react';
import {
	useAbortSessionShellJob,
	useSessionShellJobs,
} from '../../hooks/useShellJobs';
import type { ShellJob } from '../../lib/api-client';
import { StableSpinner } from '../ui/StableSpinner';
import { CopyButton } from '../messages/renderers/shared';
import {
	INPUT_BAR_ATTACHED_CARD_CLASS,
	INPUT_BAR_GROUP_CLASS,
	inputBarWrapperProps,
} from './input-bar-chrome';

const RECENT_FINISHED_WINDOW_MS = 5 * 60 * 1000;
const OUTPUT_PREVIEW_CHARS = 4_000;

interface InputShellJobsBarProps {
	sessionId: string;
}

function statusColorClass(status: ShellJob['status']): string {
	if (status === 'completed') return 'text-green-600 dark:text-green-400';
	if (status === 'failed' || status === 'cancelled') {
		return 'text-red-600 dark:text-red-400';
	}
	return 'text-muted-foreground/60';
}

function ShellJobStatusIcon({ job }: { job: ShellJob }) {
	if (job.status === 'running') {
		return <StableSpinner size="sm" title="Shell job running" />;
	}
	if (job.status === 'completed') {
		return (
			<CheckCircle2
				className={`h-3.5 w-3.5 shrink-0 ${statusColorClass(job.status)}`}
			/>
		);
	}
	return (
		<XCircle
			className={`h-3.5 w-3.5 shrink-0 ${statusColorClass(job.status)}`}
		/>
	);
}

function statusLabel(job: ShellJob): string {
	if (job.status === 'running') return 'running';
	if (job.exitCode !== null && job.status === 'completed') {
		return job.exitCode === 0 ? 'done' : `exit ${job.exitCode}`;
	}
	return job.status;
}

function ShellJobRow({ job, sessionId }: { job: ShellJob; sessionId: string }) {
	const [showOutput, setShowOutput] = useState(false);
	const [outputHeight, setOutputHeight] = useState(0);
	const outputMeasureRef = useRef<HTMLDivElement>(null);
	const outputScrollRef = useRef<HTMLDivElement>(null);
	const abortMutation = useAbortSessionShellJob(sessionId);
	const isRunning = job.status === 'running';
	const hasOutput = job.output.trim().length > 0;
	const outputPreview = useMemo(() => {
		const trimmed = job.output.replace(/\s+$/, '');
		if (trimmed.length <= OUTPUT_PREVIEW_CHARS) return trimmed;
		return `…\n${trimmed.slice(-OUTPUT_PREVIEW_CHARS)}`;
	}, [job.output]);

	useLayoutEffect(() => {
		const element = outputMeasureRef.current;
		if (!element) return;
		const updateHeight = () => {
			setOutputHeight(Math.min(element.scrollHeight, 176));
		};
		updateHeight();
		const observer = new ResizeObserver(updateHeight);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!showOutput || outputPreview.length === 0) return;
		const element = outputScrollRef.current;
		if (!element) return;
		element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
	}, [outputPreview, showOutput]);

	return (
		<div className="min-w-0">
			<div className="flex w-full items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/60">
				<span className="flex shrink-0" title={statusLabel(job)}>
					<ShellJobStatusIcon job={job} />
				</span>
				<button
					type="button"
					disabled={!hasOutput}
					onClick={() => setShowOutput((value) => !value)}
					className={`flex flex-1 items-center gap-2 min-w-0 text-left ${hasOutput ? 'cursor-pointer' : 'cursor-default'}`}
					title={hasOutput ? 'Toggle output' : job.command}
				>
					<span className="text-xs text-foreground font-mono truncate flex-1">
						{job.command}
					</span>
				</button>
				{isRunning && (
					<button
						type="button"
						onClick={() => abortMutation.mutate({ jobId: job.id })}
						disabled={abortMutation.isPending}
						className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 flex-shrink-0"
						title="Stop shell job"
						aria-label="Stop shell job"
					>
						<Square className="h-3 w-3 fill-current" />
					</button>
				)}
				{hasOutput && (
					<button
						type="button"
						onClick={() => setShowOutput((value) => !value)}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						aria-label={
							showOutput ? 'Collapse shell output' : 'Expand shell output'
						}
						title={showOutput ? 'Collapse output' : 'Expand output'}
					>
						{showOutput ? (
							<ChevronDown className="h-3.5 w-3.5" />
						) : (
							<ChevronRight className="h-3.5 w-3.5" />
						)}
					</button>
				)}
			</div>
			<div
				className="overflow-hidden transition-[height,opacity] duration-200 ease-out"
				style={{
					height: showOutput && hasOutput ? `${outputHeight + 42}px` : '0px',
					opacity: showOutput && hasOutput ? 1 : 0,
				}}
			>
				<div className="mx-3 mt-2 mb-2 overflow-hidden rounded-md border border-border bg-background/80 shadow-inner">
					<div className="flex h-8 items-center gap-2 border-b border-border bg-muted/40 px-2.5">
						<div className="flex gap-1" aria-hidden="true">
							<span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
							<span className="h-1.5 w-1.5 rounded-full bg-amber-400/70" />
							<span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
						</div>
						<span className="ml-1 flex-1 truncate font-mono text-[10px] text-muted-foreground">
							{job.cwd && job.cwd !== '.' ? job.cwd : 'output'}
						</span>
						<CopyButton
							text={outputPreview}
							className="text-muted-foreground hover:bg-muted hover:text-foreground"
						/>
					</div>
					<div
						ref={outputScrollRef}
						className="overflow-auto transition-[height] duration-200 ease-out"
						style={{ height: `${outputHeight}px` }}
					>
						<div ref={outputMeasureRef}>
							<pre className="px-3 py-2.5 text-[11px] leading-relaxed text-foreground/85 font-mono whitespace-pre-wrap break-words selection:bg-primary/20">
								{outputPreview}
							</pre>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * Stacked bar above the chat input listing detached shell jobs for the
 * session: running jobs plus jobs finished within the recent window. Rows
 * expand to a bounded scrollable output preview and expose a stop control
 * while running.
 */
export const InputShellJobsBar = memo(function InputShellJobsBar({
	sessionId,
}: InputShellJobsBarProps) {
	const { data } = useSessionShellJobs(sessionId);
	const [isExpanded, setIsExpanded] = useState(false);

	const jobs = useMemo(() => data?.jobs ?? [], [data?.jobs]);
	const running = jobs.filter(
		(job) => job.detached && job.status === 'running',
	);
	const recentFinished = jobs.filter(
		(job) =>
			job.detached &&
			job.status !== 'running' &&
			Date.now() - job.updatedAt < RECENT_FINISHED_WINDOW_MS,
	);
	const visible = [...running, ...recentFinished];
	const currentJob = running[0] ?? visible[0];
	const hasContent = visible.length > 0;

	return (
		<div
			className={`${INPUT_BAR_GROUP_CLASS} grid transition-[grid-template-rows,opacity] duration-200 ease-out`}
			{...inputBarWrapperProps(hasContent)}
			style={{
				gridTemplateRows: hasContent ? '1fr' : '0fr',
				opacity: hasContent ? 1 : 0,
			}}
		>
			<div className="overflow-hidden">
				<div
					className={`border border-border bg-card overflow-hidden ${INPUT_BAR_ATTACHED_CARD_CLASS}`}
				>
					<button
						type="button"
						onClick={() => setIsExpanded((value) => !value)}
						aria-expanded={isExpanded}
						className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted cursor-pointer ${isExpanded ? 'border-b border-border' : ''}`}
					>
						<Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						<span className="shrink-0 text-xs font-medium text-foreground">
							Shell jobs
						</span>
						{!isExpanded && currentJob && (
							<>
								<span className="h-3 w-px shrink-0 bg-border" />
								<span className="flex shrink-0" title={statusLabel(currentJob)}>
									<ShellJobStatusIcon job={currentJob} />
								</span>
								<span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
									{currentJob.command}
								</span>
							</>
						)}
						{isExpanded && (
							<span className="ml-auto text-[11px] text-muted-foreground">
								{visible.length} {visible.length === 1 ? 'job' : 'jobs'}
							</span>
						)}
						{isExpanded ? (
							<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						) : (
							<ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						)}
					</button>
					<div
						className="grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out"
						style={{
							gridTemplateRows: isExpanded ? '1fr' : '0fr',
							opacity: isExpanded ? 1 : 0,
							visibility: isExpanded ? 'inherit' : 'hidden',
						}}
					>
						<div className="overflow-hidden">
							<div className="divide-y divide-border">
								{visible.map((job) => (
									<ShellJobRow key={job.id} job={job} sessionId={sessionId} />
								))}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
});
