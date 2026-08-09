import { memo, useCallback, useState } from 'react';
import { FileWarning } from 'lucide-react';
import type { MessagePart } from '../../types/api';
import { apiClient } from '../../lib/api-client';
import { toast } from '../../stores/toastStore';

function formatBytes(bytes?: number) {
	if (!bytes || bytes <= 0) return null;
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getSessionIdFromArtifactPath(artifactPath?: string) {
	const match = artifactPath?.match(/\/v1\/sessions\/([^/]+)\/parts\//);
	return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Compact affordance for parts whose content the paged message route capped.
 * The full payload stays on the server until the user asks for it.
 */
export const TruncatedPartNotice = memo(function TruncatedPartNotice({
	part,
	sessionId,
}: {
	part: MessagePart;
	sessionId?: string;
}) {
	const [loading, setLoading] = useState(false);
	const size = formatBytes(part.contentBytes);
	const resolvedSessionId =
		sessionId ?? getSessionIdFromArtifactPath(part.artifactPath);

	const handleOpen = useCallback(async () => {
		if (!resolvedSessionId || loading) return;
		setLoading(true);
		try {
			const content = await apiClient.getMessagePartContent(
				resolvedSessionId,
				part.id,
			);
			const url = URL.createObjectURL(
				new Blob([content], { type: 'text/plain' }),
			);
			window.open(url, '_blank', 'noopener,noreferrer');
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Failed to load full result',
			);
		} finally {
			setLoading(false);
		}
	}, [resolvedSessionId, part.id, loading]);

	return (
		<div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground/80">
			<FileWarning className="h-3 w-3 flex-shrink-0 text-amber-500" />
			<span className="truncate">
				Result truncated{size ? ` · ${size} total` : ''}
			</span>
			{resolvedSessionId && (
				<button
					type="button"
					onClick={handleOpen}
					disabled={loading}
					className="text-foreground/80 underline decoration-border underline-offset-2 transition-colors hover:text-foreground disabled:opacity-60"
				>
					{loading ? 'Loading…' : 'View full result'}
				</button>
			)}
		</div>
	);
});
