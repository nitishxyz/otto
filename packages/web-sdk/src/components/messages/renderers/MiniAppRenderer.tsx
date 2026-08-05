import { AppWindow, ExternalLink, FolderOpen, ShieldCheck } from 'lucide-react';
import { useViewerTabsStore } from '../../../stores/viewerTabsStore';
import { resolveMiniAppPreviewUrl } from '../../../lib/mini-app-preview';
import { Button } from '../../ui/Button';
import type { GenericRendererProps } from './types';
import { formatDuration } from './utils';
import { ToolErrorDisplay } from './ToolErrorDisplay';
import {
	ToolHeader,
	ToolHeaderError,
	ToolHeaderMeta,
	ToolHeaderSeparator,
	ToolHeaderSuccess,
} from './shared';

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function getString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

function getStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

function getPreviewUrl(value: unknown): string | null {
	const url = getString(value);
	if (!url) return null;
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		if (
			(parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
			(host === 'localhost' || host === '127.0.0.1' || host === '[::1]')
		) {
			return parsed.toString();
		}
	} catch {}
	return null;
}

function getPreviewPath(value: unknown): string | null {
	const path = getString(value);
	return path &&
		/^\/v1\/mini-apps\/[a-z0-9-]+\/revisions\/[a-f0-9]{12}\/$/.test(path)
		? path
		: null;
}

function resolvePreviewUrl(
	artifact: Record<string, unknown> | null,
): string | null {
	const explicitUrl = getPreviewUrl(artifact?.previewUrl);
	if (explicitUrl) return explicitUrl;
	const previewPath = getPreviewPath(artifact?.previewPath);
	return previewPath ? resolveMiniAppPreviewUrl(previewPath) : null;
}

export function MiniAppRenderer({
	contentJson,
	toolDurationMs,
	isExpanded,
	onToggle,
	compact,
}: GenericRendererProps) {
	const result = getRecord(contentJson.result) ?? {};
	const artifact =
		getRecord(result.artifact) ??
		getRecord(result.app) ??
		getRecord(contentJson.artifact);
	const hasError =
		result.ok === false || Boolean(contentJson.error) || !artifact;
	const error =
		getString(result.error) ??
		getString(contentJson.error) ??
		getString(contentJson.message) ??
		'Mini App validation failed.';
	const name = getString(artifact?.name) ?? 'Mini App';
	const appId = getString(artifact?.appId) ?? 'unknown';
	const description = getString(artifact?.description);
	const root = getString(artifact?.root);
	const entry = getString(artifact?.entry);
	const revisionId = getString(artifact?.revisionId) ?? 'unknown';
	const previewUrl = resolvePreviewUrl(artifact);
	const permissions = getStringArray(artifact?.permissions);
	const capabilities = getStringArray(artifact?.capabilities);

	const openPreview = () => {
		if (!previewUrl) return;
		useViewerTabsStore.getState().openMiniAppTab({
			appId,
			title: name,
			url: previewUrl,
			revisionId,
		});
	};

	return (
		<div className="text-[12px]">
			<ToolHeader
				toolName="mini app"
				isExpanded={isExpanded}
				onToggle={onToggle}
				isError={hasError}
				colorVariant="purple"
				canExpand
			>
				<ToolHeaderSeparator />
				<span className="min-w-0 truncate text-foreground/70">{name}</span>
				{!compact && (
					<>
						<ToolHeaderSeparator />
						{hasError ? (
							<ToolHeaderError>invalid</ToolHeaderError>
						) : (
							<ToolHeaderSuccess>ready</ToolHeaderSuccess>
						)}
						<ToolHeaderSeparator />
						<ToolHeaderMeta>{formatDuration(toolDurationMs)}</ToolHeaderMeta>
					</>
				)}
			</ToolHeader>

			{!compact && !hasError && (
				<div className="mt-2 ml-5 overflow-hidden rounded-xl border border-border bg-muted/20">
					<div className="flex items-start gap-3 p-3">
						<div className="rounded-lg bg-purple-500/10 p-2 text-purple-600 dark:text-purple-300">
							<AppWindow className="h-5 w-5" />
						</div>
						<div className="min-w-0 flex-1">
							<div className="font-medium text-foreground">{name}</div>
							{description && (
								<div className="mt-0.5 line-clamp-2 text-muted-foreground">
									{description}
								</div>
							)}
							<div className="mt-1 font-mono text-[10px] text-muted-foreground">
								{appId} · rev {revisionId}
							</div>
						</div>
						{previewUrl && (
							<Button
								type="button"
								variant="secondary"
								size="sm"
								className="shrink-0 gap-1.5 text-xs"
								onClick={openPreview}
							>
								<ExternalLink className="h-3.5 w-3.5" />
								Open app
							</Button>
						)}
					</div>
					{!previewUrl && (
						<div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
							Validated source package. Start a local preview to interact with
							it.
						</div>
					)}
				</div>
			)}

			{isExpanded && (
				<div className="mt-2 ml-5 flex max-w-full flex-col gap-2">
					{hasError ? (
						<ToolErrorDisplay error={error} />
					) : (
						<div className="grid gap-2 rounded-lg border border-border bg-muted/10 p-3 text-[11px]">
							{root && (
								<div className="flex items-center gap-2 font-mono text-foreground/70">
									<FolderOpen className="h-3.5 w-3.5 shrink-0" />
									<span className="truncate">
										{root}/{entry}
									</span>
								</div>
							)}
							<div className="flex items-center gap-2 text-foreground/70">
								<ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
								<span>
									{permissions.length} permissions · {capabilities.length}{' '}
									capabilities
								</span>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
