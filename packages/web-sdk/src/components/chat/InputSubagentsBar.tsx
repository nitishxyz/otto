import { memo, useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronUp } from 'lucide-react';
import { useSessionSubagents } from '../../hooks/useGoals';
import type { Subagent } from '../../lib/api-client';
import { useSubagentViewerStore } from '../../stores/subagentViewerStore';
import { StableSpinner } from '../ui/StableSpinner';

interface InputSubagentsBarProps {
	sessionId: string;
}

function statusColorClass(status: Subagent['status']): string {
	if (status === 'completed') return 'text-green-600 dark:text-green-400';
	if (status === 'failed') return 'text-red-600 dark:text-red-400';
	return 'text-muted-foreground/60';
}

function SubagentRow({ record }: { record: Subagent }) {
	const openViewer = useSubagentViewerStore((state) => state.open);
	return (
		<button
			type="button"
			onClick={() =>
				openViewer({
					childSessionId: record.childSessionId,
					agent: record.agent,
					task: record.task,
				})
			}
			className="flex w-full items-center gap-2 min-w-0 px-3 py-2 text-left transition-colors hover:bg-muted cursor-pointer"
			title="Open sub-agent session"
		>
			{record.status === 'running' ? (
				<StableSpinner size="sm" title="Sub-agent running" />
			) : (
				<Bot
					className={`h-3.5 w-3.5 flex-shrink-0 ${statusColorClass(record.status)}`}
				/>
			)}
			<span className="text-xs font-medium text-foreground flex-shrink-0">
				{record.agent}
			</span>
			<span className="text-xs text-muted-foreground truncate flex-1">
				{record.task}
			</span>
			<span className="text-[11px] text-muted-foreground flex-shrink-0">
				{record.status}
			</span>
		</button>
	);
}

export const InputSubagentsBar = memo(function InputSubagentsBar({
	sessionId,
}: InputSubagentsBarProps) {
	const { data } = useSessionSubagents(sessionId);
	const [isExpanded, setIsExpanded] = useState(true);

	const subagents = useMemo(() => data?.subagents ?? [], [data?.subagents]);
	const running = subagents.filter((record) => record.status === 'running');
	const recentFinished = subagents.filter(
		(record) =>
			record.status !== 'running' &&
			Date.now() - record.updatedAt < 5 * 60 * 1000,
	);
	const visible = [...running, ...recentFinished];
	const hasContent = visible.length > 0;

	return (
		<div
			className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
			style={{
				gridTemplateRows: hasContent ? '1fr' : '0fr',
				opacity: hasContent ? 1 : 0,
			}}
		>
			<div className="overflow-hidden">
				<div className="border border-border border-b-0 bg-card rounded-t-xl overflow-hidden -mb-1 pb-2">
					<button
						type="button"
						aria-expanded={isExpanded}
						aria-label={
							isExpanded ? 'Collapse sub-agents' : 'Expand sub-agents'
						}
						onClick={() => setIsExpanded((value) => !value)}
						className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted cursor-pointer"
					>
						<Bot className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
						<span className="text-xs font-medium text-foreground flex-shrink-0">
							Sub-agents
						</span>
						<span className="flex-1" />
						{running.length > 0 && (
							<span className="text-[11px] text-muted-foreground flex-shrink-0">
								{running.length} running
							</span>
						)}
						{isExpanded ? (
							<ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
						) : (
							<ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
						)}
					</button>

					<div
						className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
						style={{
							gridTemplateRows: isExpanded ? '1fr' : '0fr',
							opacity: isExpanded ? 1 : 0,
						}}
					>
						<div className="overflow-hidden">
							<div className="divide-y divide-border border-t border-border">
								{visible.map((record) => (
									<SubagentRow key={record.id} record={record} />
								))}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
});
