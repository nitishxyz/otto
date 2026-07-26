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
	context?: SubagentContext;
};

type SubagentContext = {
	usedTokens?: number;
	windowTokens?: number | null;
	percentUsed?: number | null;
};

type SubagentActivityItem = {
	tool?: string;
	status?: string;
	input?: string;
	result?: string;
};

function formatContext(context: SubagentContext | undefined): string | null {
	if (!context) return null;
	const used = context.usedTokens;
	const window = context.windowTokens;
	if (typeof used !== 'number') return null;
	const usedLabel = used.toLocaleString();
	if (typeof window !== 'number') return `${usedLabel} tokens`;
	const percent =
		typeof context.percentUsed === 'number'
			? ` (${context.percentUsed.toFixed(1)}%)`
			: '';
	return `${usedLabel} / ${window.toLocaleString()} tokens${percent}`;
}

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
	const legacyActions: Record<string, string> = {
		delegate_task: 'delegate',
		list_subagents: 'list',
		message_subagent: 'message',
		stop_subagent: 'stop',
		retry_subagent: 'retry',
	};
	const action = String(args.action ?? legacyActions[name] ?? 'delegate');
	const statusRecord =
		result.subagent && typeof result.subagent === 'object'
			? (result.subagent as SubagentListItem)
			: undefined;
	const activity = Array.isArray(result.activity)
		? (result.activity as SubagentActivityItem[])
		: [];
	const statusContextLabel = formatContext(statusRecord?.context);

	const isList = action === 'list';
	const records: SubagentListItem[] = isList
		? Array.isArray(result.subagents)
			? (result.subagents as SubagentListItem[])
			: []
		: [];

	const agent = String(result.agent ?? statusRecord?.agent ?? args.agent ?? '');
	const detail = String(
		action === 'delegate'
			? (args.task ?? '')
			: action === 'message'
				? (args.message ?? '')
				: (args.subagentId ?? ''),
	);

	let headline: string;
	if (hasError) headline = String(result.error ?? 'error');
	else if (isList) {
		const running = records.filter((r) => r.status === 'running').length;
		headline = `${records.length} sub-agent${records.length === 1 ? '' : 's'}${running ? `, ${running} running` : ''}`;
	} else if (action === 'status') {
		headline = statusRecord
			? `${statusRecord.agent} — ${statusRecord.status}${statusContextLabel ? ` — ${statusContextLabel}` : ''}`
			: `Check sub-agent${detail ? ` ${detail}` : ''}`;
	} else if (action === 'read') {
		headline = `${agent || 'Sub-agent'} — ${activity.length} recent tool call${activity.length === 1 ? '' : 's'}`;
	} else if (action === 'compact') {
		headline = `${agent ? `${agent} — ` : ''}Compact context`;
	} else if (action === 'stop' || action === 'retry') {
		headline = `${action === 'stop' ? 'Stop' : 'Retry'} sub-agent${detail ? ` ${detail}` : ''}`;
	} else {
		headline = agent ? `${agent}${detail ? ` — ${detail}` : ''}` : detail;
	}

	const canExpand = isList
		? records.length > 0
		: Boolean(detail || hasError || statusRecord || activity.length);
	const isAsync = ['delegate', 'message', 'compact', 'retry'].includes(action);
	const detailNote =
		action === 'delegate'
			? 'Runs in parallel; results arrive automatically.'
			: action === 'compact'
				? 'Compacts the idle child session without changing its task result.'
				: action === 'message' || action === 'retry'
					? 'Results arrive automatically.'
					: '';

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
				{!hasError && !compact && isAsync && (
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
					) : action === 'status' && statusRecord ? (
						<div className="text-[11px] text-foreground/70">
							<span className="font-medium text-foreground/90">
								{statusRecord.agent} — {statusRecord.status}
							</span>
							{statusContextLabel ? (
								<span className="block text-muted-foreground">
									Context: {statusContextLabel}
								</span>
							) : null}
							{statusRecord.summary ? (
								<span className="block text-muted-foreground line-clamp-3">
									{statusRecord.summary}
								</span>
							) : null}
						</div>
					) : action === 'read' ? (
						activity.map((item, index) => (
							<div
								key={`${item.tool ?? 'tool'}-${index}`}
								className="text-[11px]"
							>
								<span className="font-medium text-foreground/90">
									{item.tool ?? 'tool'}
								</span>{' '}
								<span className="text-muted-foreground">{item.status}</span>
								{item.input ? (
									<span className="block truncate font-mono text-muted-foreground">
										{item.input}
									</span>
								) : null}
								{item.result ? (
									<span className="block line-clamp-2 font-mono text-muted-foreground/80">
										{item.result}
									</span>
								) : null}
							</div>
						))
					) : (
						<div className="text-[11px] text-foreground/70">
							{detail}
							{detailNote ? (
								<span className="block text-muted-foreground">
									{detailNote}
								</span>
							) : null}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
