import { Bot, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { GenericRendererProps } from './types';
import { formatDuration } from './utils';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolHeaderError,
} from './shared';

type SubagentListItem = {
	id: string;
	agent: string;
	task: string;
	status: string;
	summary?: string;
	childSessionId?: string;
};

function statusIcon(status: string) {
	if (status === 'running')
		return <Loader2 className="h-3 w-3 animate-spin text-blue-500" />;
	if (status === 'completed')
		return <CheckCircle2 className="h-3 w-3 text-green-500" />;
	return <XCircle className="h-3 w-3 text-red-400" />;
}

export function SubagentToolRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
	toolName,
}: GenericRendererProps) {
	const result = (contentJson.result || {}) as Record<string, unknown>;
	const args = (contentJson.args || {}) as Record<string, unknown>;
	const timeStr = formatDuration(toolDurationMs);
	const hasError = result.ok === false;
	const name = toolName ?? 'subagent';

	const isList = name === 'list_subagents';
	const records: SubagentListItem[] = isList
		? Array.isArray(result.subagents)
			? (result.subagents as SubagentListItem[])
			: []
		: [];

	const spawnAgent = String(result.agent ?? args.agent ?? '');
	const spawnTask = String(args.task ?? args.message ?? '');

	let headline: string;
	if (hasError) headline = String(result.error ?? 'error');
	else if (isList) {
		const running = records.filter((r) => r.status === 'running').length;
		headline = `${records.length} sub-agent${records.length === 1 ? '' : 's'}${running ? `, ${running} running` : ''}`;
	} else {
		headline = spawnAgent
			? `${spawnAgent}${spawnTask ? ` — ${spawnTask}` : ''}`
			: spawnTask;
	}

	const canExpand = isList
		? records.length > 0
		: Boolean(spawnTask || hasError);

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName={name}
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="purple"
				canExpand={canExpand}
			>
				{!compact && (
					<>
						<ToolHeaderSeparator />
						<Bot className="h-3 w-3 shrink-0 text-purple-400" />
						<span className="max-w-[300px] truncate font-mono text-[11px] text-foreground/60">
							{headline}
						</span>
					</>
				)}
				{!hasError && !compact && !isList && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderSuccess>async</ToolHeaderSuccess>
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
					{hasError ? (
						<div className="text-[11px] text-red-500">
							{String(result.error ?? 'error')}
						</div>
					) : isList ? (
						records.map((record) => (
							<div
								key={record.id}
								className="flex items-start gap-1.5 text-[11px]"
							>
								<span className="mt-0.5 shrink-0">
									{statusIcon(record.status)}
								</span>
								<span className="min-w-0 text-foreground/70">
									<span className="font-medium text-foreground/90">
										{record.agent}
									</span>{' '}
									— {record.task}
									{record.summary ? (
										<span className="block text-muted-foreground line-clamp-2">
											{record.summary}
										</span>
									) : null}
								</span>
							</div>
						))
					) : (
						<div className="text-[11px] text-foreground/70">
							{spawnTask}
							<span className="block text-muted-foreground">
								Runs in parallel; results arrive automatically.
							</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
