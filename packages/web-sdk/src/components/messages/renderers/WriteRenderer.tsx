import { ChevronRight, AlertCircle } from 'lucide-react';
import type { RendererProps } from './types';
import { DiffView } from './DiffView';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';

export function WriteRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: RendererProps) {
	const result = contentJson.result || {};
	const args = contentJson.args || {};
	const artifact = contentJson.artifact;

	const hasToolError =
		typeof result === 'object' && 'ok' in result && result.ok === false;
	const errorMessage =
		hasToolError && 'error' in result && typeof result.error === 'string'
			? result.error
			: null;
	const errorStack =
		hasToolError && 'stack' in result && typeof result.stack === 'string'
			? result.stack
			: undefined;

	const path = String(result.path || args.path || '');
	const bytes = Number(result.bytes || 0);
	const patch = artifact?.patch ? String(artifact.patch) : '';
	const timeStr = formatDuration(toolDurationMs);

	const canExpand = patch.length > 0 || hasToolError;

	return (
		<div className="text-[12px]">
			<button
				type="button"
				onClick={() => canExpand && onToggle()}
				className={`flex items-center gap-2 transition-colors min-w-0 w-full ${
					hasToolError
						? 'text-red-700 dark:text-red-300 hover:text-red-600 dark:hover:text-red-200'
						: canExpand
							? 'text-emerald-700 dark:text-emerald-300 hover:text-emerald-600 dark:hover:text-emerald-200'
							: 'text-emerald-700 dark:text-emerald-300'
				}`}
			>
				{canExpand ? (
					isExpanded ? (
						<ChevronRight className="h-3 w-3 flex-shrink-0 rotate-90 transition-transform" />
					) : (
						<ChevronRight className="h-3 w-3 flex-shrink-0 transition-transform" />
					)
				) : (
					<div className="w-3 flex-shrink-0" />
				)}
				{hasToolError && (
					<AlertCircle className="h-3 w-3 flex-shrink-0 text-red-600 dark:text-red-400" />
				)}
				<span className="font-medium flex-shrink-0">
					write{hasToolError ? ' error' : ''}
				</span>
				{!compact && (
					<>
						<span className="text-muted-foreground/70 flex-shrink-0">·</span>
						<span
							className="text-foreground/70 min-w-0 flex-shrink overflow-hidden text-ellipsis whitespace-nowrap"
							dir="rtl"
							title={path}
						>
							{`\u2066${path}\u2069`}
						</span>
					</>
				)}
				{!hasToolError && bytes > 0 && !compact && (
					<span className="text-muted-foreground/80 whitespace-nowrap flex-shrink-0">
						· {bytes} bytes · {timeStr}
					</span>
				)}
				{hasToolError && !compact && (
					<span className="text-muted-foreground/80 flex-shrink-0">
						· {timeStr}
					</span>
				)}
			</button>
			{isExpanded && hasToolError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
			)}
			{isExpanded && !hasToolError && patch && (
				<div className="mt-2 ml-5">
					<DiffView patch={patch} />
				</div>
			)}
		</div>
	);
}
