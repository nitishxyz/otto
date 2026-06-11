import { memo, useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const SUBAGENT_RESULTS_TAG = '<subagent_results>';

export function isSubagentResultsMessage(content: string): boolean {
	return content.trimStart().startsWith(SUBAGENT_RESULTS_TAG);
}

interface ParsedSubagentResult {
	id: string;
	agent: string;
	status: string;
	task: string;
	result: string;
}

const RESULT_BLOCK_RE =
	/<subagent_result\s+id="([^"]*)"\s+agent="([^"]*)"\s+status="([^"]*)">([\s\S]*?)<\/subagent_result>/g;

export function parseSubagentResults(content: string): ParsedSubagentResult[] {
	const results: ParsedSubagentResult[] = [];
	for (const match of content.matchAll(RESULT_BLOCK_RE)) {
		const body = match[4] ?? '';
		const task = /<task>([\s\S]*?)<\/task>/.exec(body)?.[1]?.trim() ?? '';
		const result = /<result>([\s\S]*?)<\/result>/.exec(body)?.[1]?.trim() ?? '';
		results.push({
			id: match[1],
			agent: match[2],
			status: match[3],
			task,
			result,
		});
	}
	return results;
}

function statusColorClass(status: string): string {
	if (status === 'completed') return 'text-green-600 dark:text-green-400';
	if (status === 'failed') return 'text-red-600 dark:text-red-400';
	return 'text-muted-foreground';
}

const SubagentResultRow = memo(function SubagentResultRow({
	result,
}: {
	result: ParsedSubagentResult;
}) {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div className="min-w-0">
			<button
				type="button"
				onClick={() => setIsExpanded((value) => !value)}
				aria-expanded={isExpanded}
				className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60 cursor-pointer min-w-0"
			>
				{isExpanded ? (
					<ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
				) : (
					<ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
				)}
				<Bot className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
				<span className="text-xs font-medium text-foreground flex-shrink-0">
					{result.agent}
				</span>
				<span className="text-xs text-muted-foreground truncate flex-1">
					{result.task}
				</span>
				<span
					className={`text-[11px] flex-shrink-0 ${statusColorClass(result.status)}`}
				>
					{result.status}
				</span>
			</button>
			{isExpanded && (
				<div className="border-t border-border/60 px-9 py-2 text-xs text-muted-foreground prose prose-xs dark:prose-invert max-w-none [&_pre]:overflow-x-auto">
					<ReactMarkdown remarkPlugins={[remarkGfm]}>
						{result.result}
					</ReactMarkdown>
				</div>
			)}
		</div>
	);
});

interface SubagentResultsNoticeProps {
	content: string;
}

/**
 * Compact rendering for the automated "sub-agent results" message injected
 * into a parent session, instead of showing the raw tagged payload as a
 * normal user message.
 */
export const SubagentResultsNotice = memo(function SubagentResultsNotice({
	content,
}: SubagentResultsNoticeProps) {
	const results = useMemo(() => parseSubagentResults(content), [content]);

	if (!results.length) return null;

	return (
		<div className="relative pb-4 pt-2">
			<div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
				<div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 bg-muted/40">
					<Bot className="h-3 w-3 text-muted-foreground" />
					<span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
						Sub-agent {results.length === 1 ? 'result' : 'results'} received
					</span>
				</div>
				<div className="divide-y divide-border/60">
					{results.map((result) => (
						<SubagentResultRow key={result.id} result={result} />
					))}
				</div>
			</div>
		</div>
	);
});
