import { memo, useMemo, useState } from 'react';
import {
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Terminal,
	XCircle,
} from 'lucide-react';
import { CopyButton } from './renderers/shared';
import {
	parseShellResults,
	type ParsedShellResult,
} from './renderers/ShellResultRenderer';

export const SHELL_RESULTS_TAG = '<shell_results>';

export function isShellResultsMessage(content: string): boolean {
	return content.trimStart().startsWith(SHELL_RESULTS_TAG);
}

type ResultOutput = {
	stdout: string;
	stderr: string;
};

function parseResultOutput(result: string): ResultOutput {
	try {
		const parsed = JSON.parse(result) as Record<string, unknown>;
		const details =
			parsed.details && typeof parsed.details === 'object'
				? (parsed.details as Record<string, unknown>)
				: undefined;
		return {
			stdout: String(parsed.stdout ?? details?.stdout ?? ''),
			stderr: String(parsed.stderr ?? details?.stderr ?? ''),
		};
	} catch {
		return { stdout: result, stderr: '' };
	}
}

const ShellResultRow = memo(function ShellResultRow({
	result,
}: {
	result: ParsedShellResult;
}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const output = useMemo(
		() => parseResultOutput(result.result),
		[result.result],
	);
	const combined = [output.stdout, output.stderr].filter(Boolean).join('\n');
	const succeeded = result.status === 'completed';

	return (
		<div className="min-w-0 border-b border-border/60 last:border-b-0">
			<button
				type="button"
				onClick={() => setIsExpanded((value) => !value)}
				aria-expanded={isExpanded}
				className="flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left transition-colors hover:bg-muted/60 cursor-pointer"
			>
				{succeeded ? (
					<CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
				) : (
					<XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
				)}
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/85">
					{result.command}
				</span>
				{isExpanded ? (
					<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				) : (
					<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				)}
			</button>

			{isExpanded && (
				<div className="mx-3 mt-1 mb-2 overflow-hidden rounded-md border border-border bg-background/80 shadow-inner">
					<div className="flex items-center gap-2 border-b border-border bg-muted/40 px-2.5 py-1.5">
						<div className="flex gap-1" aria-hidden="true">
							<span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
							<span className="h-1.5 w-1.5 rounded-full bg-amber-400/70" />
							<span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
						</div>
						<span className="ml-1 flex-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							output
						</span>
						{combined && (
							<CopyButton
								text={combined}
								className="text-muted-foreground hover:bg-muted hover:text-foreground"
							/>
						)}
					</div>
					<div className="max-h-72 overflow-auto">
						{output.stdout && (
							<pre className="px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground/85 whitespace-pre-wrap break-words selection:bg-primary/20">
								{output.stdout}
							</pre>
						)}
						{output.stderr && (
							<pre className="border-t border-destructive/20 bg-destructive/5 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-destructive whitespace-pre-wrap break-words">
								{output.stderr}
							</pre>
						)}
						{!combined && (
							<div className="px-3 py-3 font-mono text-[11px] italic text-muted-foreground">
								No output
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
});

/** Renders an internal detached-shell completion without exposing transport XML. */
export const ShellResultsNotice = memo(function ShellResultsNotice({
	content,
}: {
	content: string;
}) {
	const results = useMemo(() => parseShellResults(content), [content]);
	if (!results.length) return null;

	return (
		<div>
			<div className="overflow-hidden rounded-xl border border-border bg-muted/20 shadow-sm">
				<div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-1.5">
					<Terminal className="h-3 w-3 text-muted-foreground" />
					<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Detached shell {results.length === 1 ? 'job' : 'jobs'} completed
					</span>
				</div>
				<div>
					{results.map((result) => (
						<ShellResultRow key={result.id} result={result} />
					))}
				</div>
			</div>
		</div>
	);
});
