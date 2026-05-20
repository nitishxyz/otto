import { Globe, ExternalLink, Link } from 'lucide-react';
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

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface WebContent {
	url: string;
	content: string;
	title?: string;
}

export function WebSearchRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
}: RendererProps) {
	const result = contentJson.result || {};
	const args = (contentJson.args || {}) as Record<string, unknown>;
	const timeStr = formatDuration(toolDurationMs);

	const hasError = isToolError(result) || !!contentJson.error;
	const errorMessage =
		getErrorMessage(result) ||
		(typeof contentJson.error === 'string' ? contentJson.error : null);
	const errorStack =
		result && typeof result === 'object' && 'stack' in result
			? String(result.stack)
			: undefined;

	const isSearch = 'results' in result;
	const searchResults = (result.results as SearchResult[]) || [];
	const webContent = result as WebContent;

	const query = typeof args.query === 'string' ? args.query : undefined;
	const url = typeof args.url === 'string' ? args.url : webContent.url;

	if (isSearch) {
		return (
			<div className="text-[12px]">
				<ToolHeader
					toolName="web search"
					isExpanded={isExpanded}
					onToggle={onToggle}
					isError={hasError}
					colorVariant="purple"
					canExpand={true}
				>
					{query && (
						<>
							<ToolHeaderSeparator />
							<span
								className="font-mono text-foreground/90 text-[11px] truncate min-w-0"
								title={query}
							>
								"{query.length > 25 ? `${query.slice(0, 25)}…` : query}"
							</span>
						</>
					)}
					<ToolHeaderSeparator />
					<ToolHeaderDetail>
						{searchResults.length}{' '}
						{searchResults.length === 1 ? 'result' : 'results'}
					</ToolHeaderDetail>
					<ToolHeaderSeparator />
					<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
				</ToolHeader>

				{isExpanded && hasError && errorMessage && (
					<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
				)}

				{isExpanded && !hasError && (
					<div className="mt-2 ml-5 flex flex-col gap-2 max-w-full">
						<ToolContentBox
							title="query"
							icon={<Globe className="h-3 w-3" />}
							copyText={query}
							maxHeight=""
						>
							<div className="px-3 py-2 font-mono text-xs bg-muted/10 break-all">
								{query || '(empty)'}
							</div>
						</ToolContentBox>

						{searchResults.length > 0 && (
							<ToolContentBox
								title="results"
								copyText={searchResults
									.map((r) => `${r.title}\n${r.url}`)
									.join('\n\n')}
								maxHeight="max-h-80"
							>
								<div className="divide-y divide-border/50">
									{searchResults.map((item, i) => (
										<div
											key={`${item.url}-${i}`}
											className="px-3 py-2 hover:bg-muted/20"
										>
											<a
												href={item.url}
												target="_blank"
												rel="noopener noreferrer"
												className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium"
											>
												{item.title}
												<ExternalLink className="h-3 w-3 flex-shrink-0" />
											</a>
											<p className="text-muted-foreground text-xs mt-0.5">
												{item.snippet}
											</p>
											<p className="text-xs text-muted-foreground/60 truncate mt-0.5">
												{item.url}
											</p>
										</div>
									))}
								</div>
							</ToolContentBox>
						)}

						{searchResults.length === 0 && (
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

	const displayUrl = url && url.length > 50 ? `${url.slice(0, 50)}...` : url;

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="web fetch"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="purple"
				canExpand={true}
			>
				{displayUrl && (
					<>
						<ToolHeaderSeparator />
						<span className="text-foreground/70 truncate min-w-0" title={url}>
							{displayUrl}
						</span>
					</>
				)}
				<ToolHeaderSeparator />
				<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
			</ToolHeader>

			{isExpanded && hasError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
			)}

			{isExpanded && !hasError && (
				<div className="mt-2 ml-5 flex flex-col gap-2 max-w-full">
					<ToolContentBox
						title="url"
						icon={<Link className="h-3 w-3" />}
						copyText={url}
						maxHeight=""
					>
						<div className="px-3 py-2 font-mono text-xs bg-muted/10 break-all">
							<a
								href={url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-blue-600 dark:text-blue-400 hover:underline"
							>
								{url}
							</a>
						</div>
					</ToolContentBox>

					{webContent.content && (
						<ToolContentBox
							title="content"
							copyText={webContent.content}
							maxHeight="max-h-80"
						>
							<div className="px-3 py-2 text-xs text-foreground/80 whitespace-pre-wrap break-words">
								{webContent.content}
							</div>
						</ToolContentBox>
					)}

					{!webContent.content && (
						<ToolContentBox title="content" maxHeight="">
							<div className="px-3 py-2 text-muted-foreground/60 italic">
								No content returned
							</div>
						</ToolContentBox>
					)}
				</div>
			)}
		</div>
	);
}
