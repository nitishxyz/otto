import { FolderTree } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
	prism,
	vscDarkPlus,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { RendererProps } from './types';
import { formatDuration, isToolError, getErrorMessage } from './utils';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderDetail,
	ToolHeaderMeta,
	ToolContentBox,
} from './shared';
import { ToolErrorDisplay } from './ToolErrorDisplay';

export function TreeRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
}: RendererProps) {
	const result = contentJson.result || {};
	const args = (contentJson.args || {}) as Record<string, unknown>;
	const hasError = isToolError(result);
	const errorMessage = getErrorMessage(result);
	const errorStack =
		result && typeof result === 'object' && 'stack' in result
			? String(result.stack)
			: undefined;
	const tree = String(result.tree || '');
	const lines = tree.split('\n').filter((l) => l.length > 0).length;
	const timeStr = formatDuration(toolDurationMs);
	const syntaxTheme = document?.documentElement.classList.contains('dark')
		? vscDarkPlus
		: prism;

	const path = typeof args.path === 'string' ? args.path : '.';
	const depth = typeof args.depth === 'number' ? args.depth : undefined;

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="tree"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="cyan"
				canExpand={true}
			>
				{path && path !== '.' && (
					<>
						<ToolHeaderSeparator />
						<span className="text-foreground/70 truncate min-w-0" title={path}>
							{path.length > 30 ? `…${path.slice(-30)}` : path}
						</span>
					</>
				)}
				<ToolHeaderSeparator />
				<ToolHeaderDetail>
					{lines} {lines === 1 ? 'item' : 'items'}
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
						title="path"
						icon={<FolderTree className="h-3 w-3" />}
						subtitle={depth ? `depth: ${depth}` : undefined}
						copyText={path}
						maxHeight=""
					>
						<div className="px-3 py-2 font-mono text-xs bg-muted/10 break-all">
							{path}
						</div>
					</ToolContentBox>

					{tree && (
						<ToolContentBox title="tree" copyText={tree} maxHeight="max-h-80">
							<div className="overflow-x-auto max-w-full">
								<SyntaxHighlighter
									language="bash"
									style={syntaxTheme}
									customStyle={{
										margin: 0,
										padding: '0.75rem',
										fontSize: '0.75rem',
										lineHeight: '1.5',
										background: 'transparent',
										maxWidth: '100%',
									}}
									wrapLines
									wrapLongLines
								>
									{tree}
								</SyntaxHighlighter>
							</div>
						</ToolContentBox>
					)}

					{!tree && (
						<ToolContentBox title="tree" maxHeight="">
							<div className="px-3 py-2 text-muted-foreground/60 italic">
								No tree output
							</div>
						</ToolContentBox>
					)}
				</div>
			)}
		</div>
	);
}
