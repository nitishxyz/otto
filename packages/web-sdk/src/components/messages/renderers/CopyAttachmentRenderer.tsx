import { AlertCircle, ChevronRight } from 'lucide-react';
import type { RendererProps } from './types';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	return typeof value === 'string' ? value : '';
}

function getNumber(
	record: Record<string, unknown>,
	key: string,
): number | null {
	const value = record[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean {
	return record[key] === true;
}

function formatBytes(bytes: number | null): string {
	if (bytes === null) return '';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shortSha(value: string): string {
	return value.length > 12 ? value.slice(0, 12) : value;
}

export function CopyAttachmentRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: RendererProps) {
	const result = isRecord(contentJson.result) ? contentJson.result : {};
	const args = isRecord(contentJson.args) ? contentJson.args : {};
	const hasToolError = result.ok === false || Boolean(contentJson.error);
	const errorMessage =
		typeof contentJson.error === 'string'
			? contentJson.error
			: typeof result.error === 'string'
				? result.error
				: null;
	const errorStack =
		typeof result.stack === 'string' ? result.stack : undefined;

	const path = getString(result, 'path') || getString(args, 'targetPath');
	const requestedPath = getString(result, 'requestedPath');
	const attachmentId =
		getString(result, 'attachmentId') || getString(args, 'attachmentId');
	const filename = getString(result, 'filename');
	const mimeType = getString(result, 'mimeType');
	const sha256 = getString(result, 'sha256');
	const bytes = getNumber(result, 'bytes');
	const extensionAdjusted = getBoolean(result, 'extensionAdjusted');
	const timeStr = formatDuration(toolDurationMs);
	const canExpand = hasToolError || Boolean(path || attachmentId || filename);

	return (
		<div className="text-[12px]">
			<button
				type="button"
				onClick={() => canExpand && onToggle()}
				className={`flex items-center gap-2 transition-colors min-w-0 w-full ${
					hasToolError
						? 'text-red-700 dark:text-red-300 hover:text-red-600 dark:hover:text-red-200'
						: 'text-emerald-700 dark:text-emerald-300 hover:text-emerald-600 dark:hover:text-emerald-200'
				}`}
				title={path || requestedPath || undefined}
			>
				{canExpand ? (
					<ChevronRight
						className={`h-3 w-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
					/>
				) : (
					<div className="w-3 flex-shrink-0" />
				)}
				{hasToolError ? (
					<AlertCircle className="h-3 w-3 flex-shrink-0 text-red-600 dark:text-red-400" />
				) : null}
				<span className="font-medium flex-shrink-0">
					copy attachment{hasToolError ? ' error' : ''}
				</span>
				{!compact && (
					<>
						<span className="text-muted-foreground/70 flex-shrink-0">·</span>
						<span
							className="text-foreground/70 min-w-0 flex-shrink overflow-hidden text-ellipsis whitespace-nowrap font-mono"
							dir="rtl"
							title={path}
						>
							{`\u2066${path || 'target'}\u2069`}
						</span>
					</>
				)}
				{extensionAdjusted && !compact && (
					<span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300 flex-shrink-0">
						ext adjusted
					</span>
				)}
				{!hasToolError && bytes !== null && !compact && (
					<span className="text-muted-foreground/80 whitespace-nowrap flex-shrink-0">
						· {formatBytes(bytes)} · {timeStr}
					</span>
				)}
				{hasToolError && !compact && (
					<span className="text-muted-foreground/80 flex-shrink-0">
						· {timeStr}
					</span>
				)}
			</button>

			{isExpanded && hasToolError && errorMessage && (
				<div className="mt-2">
					<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
				</div>
			)}

			{isExpanded && !hasToolError && (
				<div className="mt-2 ml-5 grid gap-1 rounded-md bg-muted/40 p-2 font-mono text-[0.7rem] text-foreground/80">
					{path && (
						<div className="min-w-0 truncate">
							<span className="text-muted-foreground">path:</span> {path}
						</div>
					)}
					{requestedPath && requestedPath !== path && (
						<div className="min-w-0 truncate">
							<span className="text-muted-foreground">requested:</span>{' '}
							{requestedPath}
						</div>
					)}
					{filename && (
						<div className="min-w-0 truncate">
							<span className="text-muted-foreground">original:</span>{' '}
							{filename}
						</div>
					)}
					<div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
						{attachmentId && <span>attachment: {attachmentId}</span>}
						{mimeType && <span>mime: {mimeType}</span>}
						{bytes !== null && <span>size: {formatBytes(bytes)}</span>}
						{sha256 && <span>sha256: {shortSha(sha256)}</span>}
					</div>
				</div>
			)}
		</div>
	);
}
