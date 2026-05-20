import { Search } from 'lucide-react';
import type { RendererProps } from './types';
import { formatDuration, isToolError, getErrorMessage } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderDetail,
	ToolHeaderMeta,
	ToolContentBox,
} from './shared';

export function SearchRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: RendererProps) {
	const result = contentJson.result || {};
	const args = (contentJson.args || {}) as Record<string, unknown>;
	const matches = (result.matches as Array<unknown>) || [];
	const files = (result.files as Array<unknown>) || [];
	const timeStr = formatDuration(toolDurationMs);

	const hasError = isToolError(result) || !!contentJson.error;
	const errorMessage =
		getErrorMessage(result) ||
		(typeof contentJson.error === 'string' ? contentJson.error : null);
	const errorStack =
		result && typeof result === 'object' && 'stack' in result
			? String(result.stack)
			: undefined;

	const itemCount = matches.length > 0 ? matches.length : files.length;
	const itemLabel =
		matches.length > 0
			? matches.length === 1
				? 'match'
				: 'matches'
			: files.length === 1
				? 'file'
				: 'files';

	const searchTerm = (() => {
		if (typeof args.pattern === 'string') return args.pattern;
		if (typeof args.query === 'string') return args.query;
		if (typeof args.filePattern === 'string') return args.filePattern;
		return '';
	})();

	const searchPath = (() => {
		if (typeof args.path === 'string' && args.path !== '.') return args.path;
		return undefined;
	})();

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="search"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="amber"
				canExpand={true}
			>
				{searchTerm && !compact && (
					<>
						<ToolHeaderSeparator />
						<span
							className="font-mono text-foreground/90 text-[11px] truncate min-w-0"
							title={searchTerm}
						>
							"
							{searchTerm.length > 30
								? `${searchTerm.slice(0, 30)}…`
								: searchTerm}
							"
						</span>
					</>
				)}
				{!compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderDetail>
							{itemCount} {itemLabel}
						</ToolHeaderDetail>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{isExpanded && hasError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
			)}

			{isExpanded && !hasError && (
				<div className="mt-2 ml-5 flex flex-col gap-2 max-w-full">
					<ToolContentBox
						title="query"
						icon={<Search className="h-3 w-3" />}
						subtitle={searchPath}
						copyText={searchTerm}
						maxHeight=""
					>
						<div className="px-3 py-2 font-mono text-xs bg-muted/10 break-all">
							{searchTerm || '(empty)'}
						</div>
					</ToolContentBox>

					{matches.length > 0 && (
						<ToolContentBox
							title="results"
							copyText={matches
								.map((m) => {
									const match = m as {
										file?: string;
										line?: number;
										text?: string;
									};
									return `${match.file}:${match.line}: ${match.text}`;
								})
								.join('\n')}
							maxHeight="max-h-80"
						>
							<div className="divide-y divide-border/50">
								{matches.map((match, i) => {
									const m = match as {
										file?: string;
										line?: number;
										text?: string;
									};
									return (
										<div
											key={`${m.file}-${m.line}-${i}`}
											className="px-3 py-1.5 font-mono hover:bg-muted/20"
										>
											<div className="text-blue-600 dark:text-blue-400 truncate">
												{m.file}:{m.line}
											</div>
											<div className="text-foreground/80 truncate">
												{m.text}
											</div>
										</div>
									);
								})}
							</div>
						</ToolContentBox>
					)}

					{files.length > 0 && matches.length === 0 && (
						<ToolContentBox
							title="files"
							copyText={files.map(String).join('\n')}
							maxHeight="max-h-80"
						>
							<div className="divide-y divide-border/50">
								{files.map((file) => (
									<div
										key={String(file)}
										className="px-3 py-1 font-mono text-foreground/80 truncate hover:bg-muted/20"
									>
										{String(file)}
									</div>
								))}
							</div>
						</ToolContentBox>
					)}

					{itemCount === 0 && (
						<ToolContentBox title="results" maxHeight="">
							<div className="px-3 py-2 text-muted-foreground/60 italic">
								No results found
							</div>
						</ToolContentBox>
					)}
				</div>
			)}
		</div>
	);
}
