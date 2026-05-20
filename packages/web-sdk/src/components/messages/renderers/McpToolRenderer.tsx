import { Plug } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
	prism,
	vscDarkPlus,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { GenericRendererProps } from './types';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolHeaderError,
	ToolContentBox,
	ImagePreview,
} from './shared';

function parseMcpToolName(fullName: string): { server: string; tool: string } {
	const idx = fullName.indexOf('__');
	if (idx === -1) return { server: '', tool: fullName };
	return { server: fullName.slice(0, idx), tool: fullName.slice(idx + 2) };
}

export function isMcpTool(name: string): boolean {
	return name.includes('__');
}

export function McpToolRenderer({
	toolName,
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: GenericRendererProps) {
	const { server, tool } = parseMcpToolName(toolName);
	const result = contentJson.result || {};
	const args = contentJson.args || {};
	const timeStr = formatDuration(toolDurationMs);
	const syntaxTheme = document?.documentElement.classList.contains('dark')
		? vscDarkPlus
		: prism;

	const hasToolError =
		typeof result === 'object' && 'ok' in result && result.ok === false;
	const errorMessage =
		hasToolError && 'error' in result && typeof result.error === 'string'
			? result.error
			: typeof contentJson.error === 'string'
				? (contentJson.error as unknown as string)
				: null;
	const errorStack =
		hasToolError && 'stack' in result && typeof result.stack === 'string'
			? result.stack
			: undefined;

	const resultContent =
		typeof result.result === 'string'
			? result.result
			: result.result && typeof result.result === 'object'
				? JSON.stringify(result.result, null, 2)
				: null;

	const images = Array.isArray(result.images)
		? (result.images as Array<{ data: string; mimeType: string }>)
		: [];
	const hasImages = images.length > 0;
	const hasContent =
		!hasToolError &&
		(resultContent || Object.keys(result).length > 0 || hasImages);
	const displayResult = resultContent || JSON.stringify(result, null, 2);
	const isJsonResult =
		displayResult.startsWith('{') || displayResult.startsWith('[');

	const argsPreview = Object.entries(args as Record<string, unknown>)
		.slice(0, 3)
		.map(([k, v]) => {
			const val =
				typeof v === 'string'
					? v.length > 30
						? `${v.slice(0, 27)}…`
						: v
					: JSON.stringify(v);
			return `${k}=${val}`;
		})
		.join('  ');

	const headerName = server ? `${server} › ${tool}` : tool;

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName={headerName}
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={!!hasToolError}
				colorVariant="purple"
				canExpand={!!hasContent || !!hasToolError || hasImages}
			>
				{!compact && argsPreview && (
					<>
						<ToolHeaderSeparator />
						<span className="text-foreground/60 truncate max-w-xs font-mono text-[11px]">
							{argsPreview}
						</span>
					</>
				)}
				{!hasToolError && !compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderSuccess>ok</ToolHeaderSuccess>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
				{hasToolError && !compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderError>error</ToolHeaderError>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{isExpanded && hasToolError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
			)}

			{isExpanded && !hasToolError && hasContent && (
				<div className="mt-2 ml-5 flex flex-col gap-2 max-w-full">
					{hasImages && <ImagePreview images={images} />}
					{displayResult && !hasImages && (
						<ToolContentBox
							title="result"
							icon={<Plug className="h-3 w-3" />}
							copyText={displayResult}
							maxHeight="max-h-[30rem]"
						>
							<SyntaxHighlighter
								language={isJsonResult ? 'json' : 'text'}
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
								{displayResult}
							</SyntaxHighlighter>
						</ToolContentBox>
					)}
				</div>
			)}
		</div>
	);
}
