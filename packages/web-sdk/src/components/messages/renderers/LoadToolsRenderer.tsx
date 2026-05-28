import { Check, Wrench, X } from 'lucide-react';
import type { GenericRendererProps } from './types';
import { formatDuration } from './utils';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolHeaderError,
} from './shared';

export function LoadToolsRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: GenericRendererProps) {
	const result = (contentJson.result || {}) as Record<string, unknown>;
	const args = (contentJson.args || {}) as Record<string, unknown>;
	const timeStr = formatDuration(toolDurationMs);

	const requested = Array.isArray(args.tools)
		? args.tools.filter((tool): tool is string => typeof tool === 'string')
		: [];
	const loaded = Array.isArray(result.loaded)
		? result.loaded.filter((tool): tool is string => typeof tool === 'string')
		: [];
	const notFound = Array.isArray(result.notFound)
		? result.notFound.filter((tool): tool is string => typeof tool === 'string')
		: [];
	const hasError = result.ok === false;
	const hasContent = loaded.length > 0 || notFound.length > 0;

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="load_tools"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="purple"
				canExpand={hasContent}
			>
				{!compact && (
					<>
						<ToolHeaderSeparator />
						<span className="font-mono text-[11px] text-foreground/60">
							{requested.length} requested
						</span>
					</>
				)}
				{!hasError && !compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderSuccess>{loaded.length} loaded</ToolHeaderSuccess>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
				{hasError && !compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderError>error</ToolHeaderError>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{isExpanded && hasContent && (
				<div className="mt-1.5 ml-5 flex flex-col gap-1">
					{loaded.map((name) => (
						<div key={name} className="flex items-center gap-1.5 text-[11px]">
							<Check className="h-3 w-3 text-green-500" />
							<Wrench className="h-3 w-3 text-purple-400" />
							<span className="font-mono text-foreground/70">{name}</span>
						</div>
					))}
					{notFound.map((name) => (
						<div key={name} className="flex items-center gap-1.5 text-[11px]">
							<X className="h-3 w-3 text-red-400" />
							<span className="font-mono text-foreground/40 line-through">
								{name}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
