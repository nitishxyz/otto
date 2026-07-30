import { LogOut } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
	OttoRouterWordmark,
	StableSpinner,
} from '@ottocode/web-sdk/components';
import { useConfirmationStore } from '@ottocode/web-sdk/stores';
import {
	planOttoRouterActions,
	type OttoRouterAuthPhase,
} from '../lib/ottorouter-actions';
import { runOttoRouterDeviceFlow } from '../lib/ottorouter-device-flow';
import {
	pollOttoRouterSignIn,
	signOutOttoRouter,
	startOttoRouterSignIn,
} from '../lib/machine-api';
import {
	MACHINE_AUTH_CHANGED_EVENT,
	machineAccountStore,
} from '../lib/machine-account-store';

export interface OttoRouterAccount {
	busy: boolean;
	/** Connect device-flow phase; 'pending' persists until poll resolves. */
	phase: OttoRouterAuthPhase;
	error: string | null;
	connect: () => Promise<void>;
	disconnect: () => Promise<void>;
	/** Cancels an in-flight connect flow and returns to the idle view. */
	cancel: () => void;
}

/**
 * Daemon-owned OttoRouter provider auth flow (device start/poll + sign-out).
 * Shared by the header control and the Machines tab sign-in state so both
 * trigger the same flow and refresh the machine list after auth changes.
 * While a device flow is pending the phase stays 'pending' regardless of
 * account-store refreshes, so the UI keeps its waiting state between polls.
 */
export function useOttoRouterAccount(onChanged: () => void): OttoRouterAccount {
	const [disconnectBusy, setDisconnectBusy] = useState(false);
	const [phase, setPhase] = useState<OttoRouterAuthPhase>('idle');
	const [error, setError] = useState<string | null>(null);
	const flowGenerationRef = useRef(0);
	const activeGenerationRef = useRef<number | null>(null);

	const notifyChanged = useCallback(async () => {
		// Fetch strictly after the auth change so a pre-auth in-flight poll can
		// never satisfy this refresh with stale signed-out data.
		await machineAccountStore.refreshFresh();
		onChanged();
		window.dispatchEvent(new Event(MACHINE_AUTH_CHANGED_EVENT));
	}, [onChanged]);

	const connect = useCallback(async () => {
		if (activeGenerationRef.current !== null) return;
		const generation = ++flowGenerationRef.current;
		activeGenerationRef.current = generation;
		setPhase('pending');
		setError(null);
		const result = await runOttoRouterDeviceFlow({
			start: startOttoRouterSignIn,
			openVerification: (url) => openUrl(url),
			poll: pollOttoRouterSignIn,
			isCancelled: () => flowGenerationRef.current !== generation,
		});
		if (flowGenerationRef.current !== generation) return;
		if (result.status === 'connected') {
			// Stay 'pending' until the store reflects the connected account, so
			// the Machines panel never flashes the Connect button between the
			// poll completing and the account state landing.
			await notifyChanged();
			if (flowGenerationRef.current !== generation) return;
			activeGenerationRef.current = null;
			setPhase('idle');
			return;
		}
		activeGenerationRef.current = null;
		if (result.status === 'cancelled') {
			setPhase('idle');
			return;
		}
		setPhase('error');
		setError(result.error);
	}, [notifyChanged]);

	const cancel = useCallback(() => {
		if (activeGenerationRef.current === null) return;
		flowGenerationRef.current += 1;
		activeGenerationRef.current = null;
		setPhase('idle');
		setError(null);
	}, []);

	const disconnect = useCallback(async () => {
		setDisconnectBusy(true);
		setError(null);
		try {
			await signOutOttoRouter();
		} catch (cause) {
			setError(String(cause));
		} finally {
			await notifyChanged();
			setDisconnectBusy(false);
		}
	}, [notifyChanged]);

	return {
		busy: disconnectBusy || phase === 'pending',
		phase,
		error,
		connect,
		disconnect,
		cancel,
	};
}

/**
 * Compact header control matching the Update button (h-7, rounded-full).
 * Renders nothing when signed out (the single Connect action lives in the
 * Machines tab), a neutral checking pill until the daemon answers the first
 * account-status query (no Connect flash), and — when signed in — a single
 * OttoRouter pill whose content swaps to a disconnect affordance on
 * hover/keyboard focus without changing size. Clicking (or tapping) the pill
 * asks for confirmation before disconnecting.
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
	const { busy, error, disconnect } = account;
	const plan = planOttoRouterActions({ configured, initializing });
	const openConfirmation = useConfirmationStore(
		(state) => state.openConfirmation,
	);
	const confirmDisconnect = useCallback(() => {
		openConfirmation({
			title: 'Disconnect OttoRouter?',
			message:
				'You will need to connect OttoRouter again to access remote machines and managed tunnels.',
			confirmLabel: 'Disconnect',
			variant: 'destructive',
			onConfirm: disconnect,
		});
	}, [disconnect, openConfirmation]);

	if (plan.headerControl === 'none') return null;

	if (plan.headerControl === 'checking') {
		return (
			<output
				data-no-drag
				aria-label="Checking OttoRouter connection"
				title="Checking OttoRouter connection"
				className="h-7 px-3 flex items-center gap-1.5 text-sm text-muted-foreground/70 border border-border/50 rounded-full select-none"
			>
				<StableSpinner size="xs" title="Checking OttoRouter connection" />
				<OttoRouterWordmark height={13} className="-translate-y-px" />
			</output>
		);
	}

	return (
		<div className="relative flex items-center gap-1.5">
			<button
				type="button"
				onClick={confirmDisconnect}
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
					<OttoRouterWordmark height={13} className="-translate-y-px" />
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
					<StableSpinner size="sm" title="Disconnecting" />
					Disconnect
				</span>
			</button>
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
