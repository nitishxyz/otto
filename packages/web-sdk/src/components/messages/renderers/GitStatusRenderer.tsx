import type { RendererProps } from './types';
import { formatDuration, isToolError, getErrorMessage } from './utils';
import { ToolHeader, ToolHeaderSeparator, ToolHeaderMeta } from './shared';
import { ToolErrorDisplay } from './ToolErrorDisplay';

interface StatusLine {
	status: string;
	file: string;
	type: 'staged' | 'unstaged' | 'untracked' | 'both';
}

function parseStatusLine(line: string): StatusLine | null {
	if (!line || line.length < 3) return null;
	const x = line[0];
	const y = line[1];
	const file = line.slice(3);

	if (x === '?' && y === '?') {
		return { status: '??', file, type: 'untracked' };
	}

	let type: StatusLine['type'] = 'unstaged';
	if (x !== ' ' && y !== ' ') type = 'both';
	else if (x !== ' ') type = 'staged';

	return { status: `${x}${y}`, file, type };
}

function getStatusIcon(status: string): string {
	if (status === '??') return '?';
	if (status[0] === 'A' || status[1] === 'A') return '+';
	if (status[0] === 'M' || status[1] === 'M') return '~';
	if (status[0] === 'D' || status[1] === 'D') return '-';
	if (status[0] === 'R' || status[1] === 'R') return '→';
	return status;
}

function getStatusColor(type: StatusLine['type']): string {
	switch (type) {
		case 'staged':
			return 'text-emerald-600 dark:text-emerald-400';
		case 'unstaged':
			return 'text-amber-600 dark:text-amber-400';
		case 'untracked':
			return 'text-muted-foreground/60';
		case 'both':
			return 'text-blue-600 dark:text-blue-400';
	}
}

export function GitStatusRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
}: RendererProps) {
	const result = contentJson.result || {};
	const hasError = isToolError(result);
	const errorMessage = getErrorMessage(result);
	const staged = Number(result.staged || 0);
	const unstaged = Number(result.unstaged || 0);
	const raw = (result.raw || []) as string[];
	const summary = String(result.summary || '');
	const timeStr = formatDuration(toolDurationMs);

	const statusLines = raw.map(parseStatusLine).filter(Boolean) as StatusLine[];
	const hasChanges = staged > 0 || unstaged > 0;
	const canExpand = statusLines.length > 0 || hasError || !!summary;

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="git status"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="blue"
				canExpand={canExpand}
			>
				<ToolHeaderSeparator />
				{hasChanges ? (
					<>
						{staged > 0 && (
							<span className="text-emerald-600 dark:text-emerald-400 flex-shrink-0">
								{staged} staged
							</span>
						)}
						{unstaged > 0 && (
							<span className="text-amber-600 dark:text-amber-400 flex-shrink-0">
								{unstaged} unstaged
							</span>
						)}
					</>
				) : (
					<span className="text-muted-foreground/60 flex-shrink-0">clean</span>
				)}
				<ToolHeaderSeparator />
				<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
			</ToolHeader>
			{isExpanded && hasError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} />
			)}
			{isExpanded && !hasError && (statusLines.length > 0 || summary) && (
				<div className="mt-2 ml-5">
					{statusLines.length > 0 ? (
						<div className="bg-card/60 border border-border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
							<div className="divide-y divide-border/50">
								{statusLines.map((line, i) => (
									<div
										key={`${line.file}-${i}`}
										className="flex items-center gap-2 px-3 py-1.5 font-mono hover:bg-muted/20"
									>
										<span
											className={`font-semibold w-6 flex-shrink-0 ${getStatusColor(line.type)}`}
										>
											{getStatusIcon(line.status)}
										</span>
										<span className="text-foreground/80 break-all">
											{line.file}
										</span>
									</div>
								))}
							</div>
						</div>
					) : (
						summary && (
							<div className="bg-card/60 border border-border rounded-lg p-3 text-muted-foreground">
								{summary}
							</div>
						)
					)}
				</div>
			)}
		</div>
	);
}
