import { Box, Code2, Sparkles } from 'lucide-react';
import { resolveArtifactPreviewUrl } from '../../../lib/artifact-preview';
import type { GenericRendererProps } from './types';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import {
	ToolHeader,
	ToolHeaderError,
	ToolHeaderMeta,
	ToolHeaderSeparator,
} from './shared';
import { formatDuration } from './utils';

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function getString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

function getLocalPreviewUrl(value: unknown): string | null {
	const url = getString(value);
	if (!url) return null;
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
			(host === 'localhost' || host === '127.0.0.1' || host === '[::1]')
			? parsed.toString()
			: null;
	} catch {
		return null;
	}
}

function getPreviewPath(value: unknown): string | null {
	const path = getString(value);
	return path &&
		/^\/v1\/artifacts\/[a-z0-9-]+\/revisions\/[a-f0-9]{12}\/$/.test(path)
		? path
		: null;
}

export function ArtifactRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
}: GenericRendererProps) {
	const result = getRecord(contentJson.result) ?? {};
	const artifact =
		getRecord(result.artifact) ?? getRecord(contentJson.artifact);
	const hasError =
		result.ok === false || Boolean(contentJson.error) || !artifact;
	const error =
		getString(result.error) ??
		getString(contentJson.error) ??
		getString(contentJson.message) ??
		'Artifact rendering failed.';
	if (hasError) {
		return (
			<div className="text-[12px]">
				<ToolHeader
					toolName="artifact"
					isExpanded={isExpanded}
					onToggle={onToggle}
					isError
					colorVariant="purple"
					canExpand
				>
					<ToolHeaderSeparator />
					<ToolHeaderError>failed</ToolHeaderError>
					<ToolHeaderSeparator />
					<ToolHeaderMeta>{formatDuration(toolDurationMs)}</ToolHeaderMeta>
				</ToolHeader>
				{isExpanded && (
					<div className="mt-2 ml-5">
						<ToolErrorDisplay error={error} />
					</div>
				)}
			</div>
		);
	}

	const title = getString(artifact.title) ?? 'Artifact';
	const description = getString(artifact.description);
	const revisionId = getString(artifact.revisionId);
	const libraries = getStringArray(artifact.libraries);
	const previewPath = getPreviewPath(artifact.previewPath);
	const previewUrl =
		getLocalPreviewUrl(artifact.previewUrl) ??
		(previewPath ? resolveArtifactPreviewUrl(previewPath) : null);

	return (
		<section className="my-3 overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
			<header className="flex min-h-14 items-center gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
					<Sparkles className="size-4" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium text-foreground">
						{title}
					</div>
					<div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
						<Box className="size-3 shrink-0" />
						<span className="truncate">
							Otto Artifact{revisionId ? ` · rev ${revisionId}` : ''}
						</span>
					</div>
				</div>
				{libraries.length > 0 && (
					<div className="hidden items-center gap-1 rounded-full border border-border bg-background/70 px-2 py-1 text-[10px] text-muted-foreground sm:flex">
						<Code2 className="size-3" />
						React runtime
					</div>
				)}
			</header>
			{description && (
				<div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
					{description}
				</div>
			)}
			{previewUrl ? (
				<iframe
					title={title}
					src={previewUrl}
					sandbox="allow-scripts"
					referrerPolicy="no-referrer"
					loading="lazy"
					className="h-[min(680px,75vh)] min-h-[440px] w-full border-0 bg-background"
				/>
			) : (
				<div className="flex min-h-40 items-center justify-center p-6 text-center text-sm text-muted-foreground">
					Artifact preview is unavailable for this project context.
				</div>
			)}
		</section>
	);
}
