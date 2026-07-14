import { useMemo } from 'react';
import { Bot, CheckCircle2, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { RendererProps } from './types';
import { formatDuration } from './utils';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolHeaderError,
} from './shared';
import {
	parseSubagentResults,
	type ParsedSubagentResult,
} from '../SubagentResultsNotice';

/**
 * Builds the compact header summary for a set of parsed sub-agent results.
 */
export function summarizeSubagentResults(results: ParsedSubagentResult[]): {
	headline: string;
	failedCount: number;
} {
	const failedCount = results.filter(
		(result) => result.status === 'failed',
	).length;
	if (results.length === 1) {
		const only = results[0];
		return {
			headline: only.task ? `${only.agent} — ${only.task}` : only.agent,
			failedCount,
		};
	}
	const agents = [...new Set(results.map((result) => result.agent))].join(', ');
	return {
		headline: agents,
		failedCount,
	};
}

function statusColorClass(status: string): string {
	if (status === 'completed') return 'text-green-600 dark:text-green-400';
	if (status === 'failed') return 'text-red-600 dark:text-red-400';
	return 'text-muted-foreground';
}

function statusIcon(status: string) {
	if (status === 'failed')
		return <XCircle className="h-3 w-3 flex-shrink-0 text-red-500" />;
	return <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-green-500" />;
}

export function SubagentResultRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: RendererProps) {
	const raw = typeof contentJson.result === 'string' ? contentJson.result : '';
	const results = useMemo(() => parseSubagentResults(raw), [raw]);
	const timeStr = formatDuration(toolDurationMs);
	const { headline, failedCount } = summarizeSubagentResults(results);
	const canExpand = results.length > 0 || Boolean(raw.trim());
	const singleResult = results.length === 1 ? results[0] : undefined;

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="subagent_result"
				isExpanded={isExpanded}
				onToggle={onToggle}
				colorVariant="purple"
				canExpand={canExpand}
			>
				{results.length > 0 && (
					<>
						<ToolHeaderSeparator />
						{!compact && <Bot className="h-3 w-3 shrink-0 text-purple-400" />}
						<span className="flex-shrink-0 font-mono text-[11px] text-foreground/60">
							{singleResult?.agent ?? headline}
						</span>
						{singleResult?.task && (
							<>
								<ToolHeaderSeparator />
								<span className="min-w-0 max-w-[360px] truncate font-mono text-[11px] text-foreground/60">
									{singleResult.task}
								</span>
							</>
						)}
					</>
				)}
				{!compact && results.length > 0 && (
					<>
						<ToolHeaderSeparator />
						{failedCount > 0 ? (
							<ToolHeaderError>
								{failedCount} of {results.length} failed
							</ToolHeaderError>
						) : (
							<ToolHeaderSuccess>
								{results.length === 1
									? 'completed'
									: `${results.length} completed`}
							</ToolHeaderSuccess>
						)}
					</>
				)}
				{!compact && timeStr && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{isExpanded && canExpand && (
				<div className="mt-1.5 ml-5 flex min-w-0 flex-col gap-1.5">
					{results.length > 0 ? (
						results.map((result) => (
							<div
								key={result.id}
								className="min-w-0 overflow-hidden rounded-lg border border-border bg-card/60"
							>
								<div className="flex min-w-0 items-center gap-1.5 border-b border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px]">
									{statusIcon(result.status)}
									<span className="flex-shrink-0 font-medium text-foreground/90">
										{result.agent}
									</span>
									<span className="min-w-0 flex-1 truncate text-muted-foreground">
										{result.task}
									</span>
									<span
										className={`flex-shrink-0 ${statusColorClass(result.status)}`}
									>
										{result.status}
									</span>
								</div>
								<div className="prose prose-xs dark:prose-invert max-h-80 max-w-none overflow-y-auto px-3 py-2 text-xs text-muted-foreground [&_pre]:overflow-x-auto">
									<ReactMarkdown remarkPlugins={[remarkGfm]}>
										{result.result}
									</ReactMarkdown>
								</div>
							</div>
						))
					) : (
						<pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-card/60 px-3 py-2 text-[11px] text-muted-foreground">
							{raw}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}
