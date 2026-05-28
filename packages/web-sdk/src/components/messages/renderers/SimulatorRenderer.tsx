import { Check, ExternalLink, ImageIcon, X } from 'lucide-react';
import type { GenericRendererProps } from './types';
import { formatDuration } from './utils';
import {
	ToolHeader,
	ToolHeaderSeparator,
	ToolHeaderMeta,
	ToolHeaderSuccess,
	ToolHeaderError,
} from './shared';

function getString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function getActionLabel(action: string | null): string {
	switch (action) {
		case 'start':
			return 'start preview';
		case 'status':
			return 'status';
		case 'take_screenshot':
			return 'screenshot';
		case 'paste':
			return 'paste text';
		case 'launch':
			return 'launch app';
		case 'list_apps':
			return 'list apps';
		case 'accessibility_tree':
			return 'accessibility tree';
		case 'open_url':
			return 'open URL';
		default:
			return action?.replace(/_/g, ' ') || 'simulator';
	}
}

export function SimulatorRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: GenericRendererProps) {
	const result = (contentJson.result || {}) as Record<string, unknown>;
	const artifact =
		getRecord(contentJson.artifact) ?? getRecord(result.artifact);
	const args = (contentJson.args || {}) as Record<string, unknown>;
	const action = getString(args.action);
	const timeStr = formatDuration(toolDurationMs);
	const hasError = result.ok === false;
	const stream = getRecord(result.stream);
	const previewUrl = getString(result.previewUrl) ?? getString(stream?.url);
	const path = getString(result.path) ?? getString(artifact?.path);
	const imageData = getString(artifact?.data) ?? getString(result.data);
	const imageMediaType =
		getString(artifact?.mediaType) ?? getString(result.mediaType);
	const imageSrc =
		imageData && imageMediaType
			? `data:${imageMediaType};base64,${imageData}`
			: null;
	const transmittedSize =
		typeof artifact?.transmittedSize === 'number'
			? artifact.transmittedSize
			: typeof result.transmittedSize === 'number'
				? result.transmittedSize
				: null;
	const bundleId = getString(result.bundleId) ?? getString(args.bundleId);
	const foreground = getRecord(result.foreground);
	const foregroundBundleId = getString(foreground?.bundleId);
	const count = typeof result.count === 'number' ? result.count : null;
	const detail =
		path ??
		bundleId ??
		foregroundBundleId ??
		previewUrl ??
		(count !== null ? `${count} stream${count === 1 ? '' : 's'}` : null);
	const hasContent =
		Boolean(detail) ||
		Boolean(imageSrc) ||
		Boolean(result.error) ||
		Boolean(result.stdout) ||
		Boolean(result.stderr);
	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="simulator"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="cyan"
				canExpand={hasContent}
			>
				{!compact && (
					<>
						<ToolHeaderSeparator />
						<span className="text-foreground/70">{getActionLabel(action)}</span>
					</>
				)}
				{detail && !compact && (
					<>
						<ToolHeaderSeparator />
						<span className="truncate font-mono text-[11px] text-foreground/60">
							{detail}
						</span>
					</>
				)}
				{!hasError && !compact && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderSuccess>ok</ToolHeaderSuccess>
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
				<div className="mt-1.5 ml-5 flex flex-col gap-1 text-[11px] text-foreground/70">
					{imageSrc && (
						<div className="mb-1 overflow-hidden rounded-lg border border-border bg-card/60 max-w-full">
							<div className="flex items-center gap-2 border-border border-b bg-muted/30 px-3 py-1.5 text-muted-foreground text-xs">
								<ImageIcon className="h-3 w-3" />
								<span className="font-medium">screenshot preview</span>
								{imageMediaType && <span>{imageMediaType}</span>}
								{transmittedSize !== null && (
									<span>{transmittedSize} bytes</span>
								)}
							</div>
							<div className="overflow-auto bg-muted/10 p-3">
								<img
									alt="Simulator screenshot"
									className="max-h-[32rem] max-w-full rounded-md border border-border bg-background object-contain"
									src={imageSrc}
								/>
							</div>
						</div>
					)}
					{hasError && getString(result.error) && (
						<div className="flex items-center gap-1.5 text-red-500">
							<X className="h-3 w-3" />
							<span>{getString(result.error)}</span>
						</div>
					)}
					{!hasError && (
						<div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
							<Check className="h-3 w-3" />
							<span>{getActionLabel(action)} complete</span>
						</div>
					)}
					{previewUrl && (
						<a
							href={previewUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1.5 font-mono text-cyan-600 hover:underline dark:text-cyan-300"
						>
							<ExternalLink className="h-3 w-3" />
							{previewUrl}
						</a>
					)}
					{path && <div className="font-mono">stored: {path}</div>}
					{bundleId && <div className="font-mono">bundle: {bundleId}</div>}
					{foregroundBundleId && (
						<div className="font-mono">foreground: {foregroundBundleId}</div>
					)}
					{getString(result.stdout) && (
						<pre className="max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-[10px] whitespace-pre-wrap">
							{getString(result.stdout)}
						</pre>
					)}
					{getString(result.stderr) && (
						<pre className="max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-[10px] whitespace-pre-wrap text-amber-600 dark:text-amber-300">
							{getString(result.stderr)}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}
