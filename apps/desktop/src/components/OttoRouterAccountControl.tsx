import { LogOut, Radio, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
	pollOttoRouterSignIn,
	signOutOttoRouter,
	startOttoRouterSignIn,
} from '../lib/machine-api';
import { MACHINE_AUTH_CHANGED_EVENT } from '../lib/machine-account-store';

export interface OttoRouterAccount {
	busy: boolean;
	error: string | null;
	connect: () => Promise<void>;
	disconnect: () => Promise<void>;
}

/**
 * Daemon-owned OttoRouter provider auth flow (device start/poll + sign-out).
 * Shared by the header control and the Machines tab sign-in state so both
 * trigger the same flow and refresh the machine list after auth changes.
 */
export function useOttoRouterAccount(onChanged: () => void): OttoRouterAccount {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const notifyChanged = useCallback(() => {
		onChanged();
		window.dispatchEvent(new Event(MACHINE_AUTH_CHANGED_EVENT));
	}, [onChanged]);

	const connect = useCallback(async () => {
		setBusy(true);
		setError(null);
		try {
			const flow = await startOttoRouterSignIn();
			await openUrl(flow.verificationUri);
			const deadline = Date.now() + 10 * 60_000;
			while (Date.now() < deadline) {
				await new Promise((resolve) =>
					setTimeout(resolve, Math.max(flow.interval, 2) * 1000),
				);
				const result = await pollOttoRouterSignIn(flow.sessionId);
				if (result.status === 'complete') {
					notifyChanged();
					return;
				}
				if (result.status === 'error') {
					throw new Error(result.error || 'OttoRouter sign-in failed.');
				}
			}
			throw new Error('OttoRouter sign-in timed out.');
		} catch (cause) {
			setError(String(cause));
		} finally {
			setBusy(false);
		}
	}, [notifyChanged]);

	const disconnect = useCallback(async () => {
		setBusy(true);
		setError(null);
		try {
			await signOutOttoRouter();
			notifyChanged();
		} catch (cause) {
			setError(String(cause));
		} finally {
			setBusy(false);
		}
	}, [notifyChanged]);

	return { busy, error, connect, disconnect };
}

/**
 * Compact header control matching the Update button (h-7, rounded-full,
 * theme primary). Shows a neutral checking pill until the daemon answers the
 * first account-status query (no signed-out flash), `Connect OttoRouter`
 * when signed out, and — when signed in — a single pill (status dot +
 * OttoRouter) whose content swaps to a disconnect affordance on
 * hover/keyboard focus without changing size; clicking (or tapping) the
 * pill disconnects.
 */
export function OttoRouterAccountControl({
	configured,
	initializing = false,
	account,
}: {
	configured: boolean;
	/** True until the first daemon account-status query resolves. */
	initializing?: boolean;
	account: OttoRouterAccount;
}) {
	const { busy, error, connect, disconnect } = account;

	if (initializing) {
		return (
			<output
				data-no-drag
				aria-label="Checking OttoRouter connection"
				title="Checking OttoRouter connection"
				className="h-7 px-3 flex items-center gap-1.5 text-sm text-muted-foreground/70 border border-border/50 rounded-full select-none"
			>
				<span
					className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-pulse"
					aria-hidden="true"
				/>
				OttoRouter
			</output>
		);
	}

	return (
		<div className="relative flex items-center gap-1.5">
			{configured ? (
				<button
					type="button"
					onClick={disconnect}
					disabled={busy}
					data-no-drag
					aria-label="Disconnect OttoRouter"
					aria-busy={busy}
					title="Disconnect OttoRouter"
					className="group h-7 px-3 grid items-center text-sm text-muted-foreground border border-border/50 rounded-full transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive focus-visible:border-destructive/40 focus-visible:bg-destructive/10 focus-visible:text-destructive disabled:opacity-60"
				>
					<span
						aria-hidden="true"
						className={`col-start-1 row-start-1 flex items-center justify-center gap-1.5 transition-opacity duration-150 ${
							busy
								? 'opacity-0'
								: 'group-hover:opacity-0 group-focus-visible:opacity-0'
						}`}
					>
						<span className="w-2 h-2 rounded-full bg-primary" />
						OttoRouter
					</span>
					<span
						aria-hidden="true"
						className={`col-start-1 row-start-1 flex items-center justify-center gap-1.5 opacity-0 transition-opacity duration-150 ${
							busy
								? ''
								: 'group-hover:opacity-100 group-focus-visible:opacity-100'
						}`}
					>
						<LogOut className="w-3.5 h-3.5" />
						Disconnect
					</span>
					<span
						aria-hidden={!busy}
						className={`col-start-1 row-start-1 flex items-center justify-center gap-1.5 transition-opacity duration-150 ${
							busy ? 'opacity-100' : 'opacity-0'
						}`}
					>
						<RefreshCw className="w-3.5 h-3.5 animate-spin" />
						Disconnect
					</span>
				</button>
			) : (
				<button
					type="button"
					onClick={connect}
					disabled={busy}
					data-no-drag
					className="h-7 px-3 flex items-center gap-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors disabled:opacity-60"
					title="Connect your OttoRouter account"
				>
					{busy ? (
						<RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
					) : (
						<Radio className="w-4 h-4" aria-hidden="true" />
					)}
					{busy ? 'Connecting...' : 'Connect OttoRouter'}
				</button>
			)}
			{error && (
				<div
					role="alert"
					className="absolute right-0 top-9 z-20 w-72 rounded-lg border border-destructive/30 bg-background p-3 text-xs text-destructive shadow-xl"
				>
					{error}
				</div>
			)}
		</div>
	);
}
