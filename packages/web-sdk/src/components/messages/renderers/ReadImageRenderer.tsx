import { ImageIcon } from 'lucide-react';
import type { RendererProps } from './types';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import {
	ToolHeader,
	ToolHeaderDetail,
	ToolHeaderMeta,
	ToolHeaderSeparator,
} from './shared';

function formatBytes(bytes: unknown): string | null {
	if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null;
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KiB', 'MiB', 'GiB'];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`;
}

function getString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function getNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: undefined;
}

export function ReadImageRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: RendererProps) {
	const result = contentJson.result || {};
	const args = contentJson.args || {};
	const timeStr = formatDuration(toolDurationMs);

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

	const path = getString(result.path) || getString(args.path);
	const mediaType = getString(result.mediaType);
	const data = getString(result.data);
	const width = getNumber(result.width);
	const height = getNumber(result.height);
	const size = formatBytes(result.size);
	const transmittedSize = formatBytes(result.transmittedSize);
	const isCompressed = result.compressed === true;
	const hasImage = mediaType.length > 0 && data.length > 0;
	const canExpand = hasToolError || hasImage;
	const src = hasImage ? `data:${mediaType};base64,${data}` : undefined;
	const dimensions = width && height ? `${width}×${height}` : null;
	const sizeLabel = transmittedSize || size;

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="read_image"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasToolError}
				colorVariant="blue"
				canExpand={canExpand}
			>
				{!compact && path && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderDetail className="min-w-0 flex-shrink overflow-hidden text-ellipsis whitespace-nowrap">
							<span dir="rtl" title={path}>{`\u2066${path}\u2069`}</span>
						</ToolHeaderDetail>
					</>
				)}
				{!compact && !hasToolError && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>
							{[
								mediaType || null,
								dimensions,
								sizeLabel,
								isCompressed ? 'compressed' : null,
								timeStr || null,
							]
								.filter(Boolean)
								.join(' · ')}
						</ToolHeaderMeta>
					</>
				)}
				{!compact && hasToolError && timeStr && (
					<>
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{timeStr}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{isExpanded && hasToolError && errorMessage && (
				<ToolErrorDisplay error={errorMessage} stack={errorStack} showStack />
			)}

			{isExpanded && !hasToolError && hasImage && src && (
				<div className="mt-2 ml-5 bg-card/60 border border-border rounded-lg overflow-hidden max-w-full">
					<div className="flex items-center gap-2 text-xs px-3 py-1.5 border-b border-border text-muted-foreground bg-muted/30">
						<ImageIcon className="h-3 w-3" />
						<span className="font-medium">image preview</span>
						{mediaType && <span>{mediaType}</span>}
						{dimensions && <span>{dimensions}</span>}
						{sizeLabel && <span>{sizeLabel}</span>}
						{isCompressed && <span>compressed</span>}
					</div>
					<div className="p-3 bg-muted/10 overflow-auto">
						<img
							src={src}
							alt={path ? `Image read from ${path}` : 'Image read by tool'}
							className="max-w-full max-h-[32rem] rounded-md border border-border object-contain bg-background"
						/>
					</div>
				</div>
			)}
		</div>
	);
}
