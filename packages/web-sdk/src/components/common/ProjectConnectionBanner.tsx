import { Loader2, WifiOff } from 'lucide-react';
import { useProjectConnection } from '../../hooks/useProjectConnection';

/**
 * Floating status pill for the active project's event connection. Rendered
 * inside the chat pane (needs a relative-positioned parent) so it overlays
 * the thread under the session/lean header instead of pushing layout down.
 * Hidden while connected; shows a spinner while reconnecting and a clear
 * message with a manual Retry once reconnect attempts keep failing. Also
 * hosts the once-mounted controller that reconciles event-maintained
 * queries after a successful reconnect.
 */
export function ProjectConnectionBanner() {
	const { status, retry, retryPending } = useProjectConnection();

	if (status === 'connected') return null;

	return (
		<output
			aria-live="polite"
			className="pointer-events-auto absolute left-1/2 top-14 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/75"
		>
			{status === 'reconnecting' ? (
				<>
					<Loader2
						className="h-3 w-3 shrink-0 animate-spin"
						aria-hidden="true"
					/>
					<span>Reconnecting to project...</span>
				</>
			) : (
				<>
					<WifiOff
						className="h-3 w-3 shrink-0 text-destructive"
						aria-hidden="true"
					/>
					<span>Connection to the project was lost.</span>
					<button
						type="button"
						onClick={retry}
						disabled={retryPending}
						className="rounded-md border border-border bg-background px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
					>
						{retryPending ? 'Retrying...' : 'Retry'}
					</button>
				</>
			)}
		</output>
	);
}
