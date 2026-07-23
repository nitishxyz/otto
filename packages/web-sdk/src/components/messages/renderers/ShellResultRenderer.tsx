import { useMemo } from 'react';
import { CheckCircle2, Terminal, XCircle } from 'lucide-react';
import type { RendererProps } from './types';
import {
	ToolHeader,
	ToolHeaderError,
	ToolHeaderSeparator,
	ToolHeaderSuccess,
} from './shared';

export type ParsedShellResult = {
	id: string;
	status: string;
	exitCode: string;
	command: string;
	result: string;
};

export function parseShellResults(raw: string): ParsedShellResult[] {
	const results: ParsedShellResult[] = [];
	const pattern =
		/<shell_result id="([^"]+)" status="([^"]+)" exit_code="([^"]*)">\s*<command>([\s\S]*?)<\/command>\s*([\s\S]*?)\s*<\/shell_result>/g;
	for (const match of raw.matchAll(pattern)) {
		results.push({
			id: match[1] ?? `shell-result-${results.length}`,
			status: match[2] ?? 'completed',
			exitCode: match[3] ?? '',
			command: match[4]?.trim() ?? '',
			result: match[5]?.trim() ?? '',
		});
	}
	return results;
}

export function ShellResultRenderer({
	contentJson,
	isExpanded,
	onToggle,
	compact,
}: RendererProps) {
	const raw = typeof contentJson.result === 'string' ? contentJson.result : '';
	const results = useMemo(() => parseShellResults(raw), [raw]);
	const failed = results.filter(
		(result) => result.status !== 'completed',
	).length;
	const canExpand = results.length > 0 || Boolean(raw.trim());

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="shell_result"
				isExpanded={isExpanded}
				onToggle={onToggle}
				canExpand={canExpand}
				colorVariant="default"
			>
				<ToolHeaderSeparator />
				<Terminal className="h-3 w-3 shrink-0 text-muted-foreground" />
				<span className="truncate font-mono text-[11px] text-foreground/60">
					{results.length === 1
						? results[0]?.command
						: `${results.length} detached shell jobs`}
				</span>
				{!compact && results.length > 0 && (
					<>
						<ToolHeaderSeparator />
						{failed > 0 ? (
							<ToolHeaderError>
								{failed} of {results.length} failed
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
			</ToolHeader>

			{isExpanded && canExpand && (
				<div className="mt-1.5 ml-5 flex min-w-0 flex-col gap-1.5">
					{results.length > 0 ? (
						results.map((result) => {
							const succeeded = result.status === 'completed';
							return (
								<div
									key={result.id}
									className="min-w-0 overflow-hidden rounded-lg border border-border bg-card/60"
								>
									<div className="flex min-w-0 items-center gap-1.5 border-b border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px]">
										{succeeded ? (
											<CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
										) : (
											<XCircle className="h-3 w-3 shrink-0 text-red-500" />
										)}
										<span className="min-w-0 flex-1 truncate font-mono text-foreground/80">
											{result.command}
										</span>
										<span className="shrink-0 text-muted-foreground">
											{result.exitCode
												? `exit ${result.exitCode}`
												: result.status}
										</span>
									</div>
									{result.result && (
										<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-[11px] text-muted-foreground">
											{result.result}
										</pre>
									)}
								</div>
							);
						})
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
