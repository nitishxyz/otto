import { Loader2, WifiOff } from 'lucide-react';
import { useProjectConnection } from '../../hooks/useProjectConnection';

/**
 * Slim status banner for the active project's event connection. Hidden while
 * connected; shows a spinner while reconnecting and a clear message with a
 * manual Retry once reconnect attempts keep failing. Also hosts the
 * once-mounted controller that reconciles event-maintained queries after a
 * successful reconnect.
 */
export function ProjectConnectionBanner() {
	const { status, retry, retryPending } = useProjectConnection();

	if (status === 'connected') return null;

	return (
		<output
			aria-live="polite"
			className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground"
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
