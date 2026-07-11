export interface OttoRouterActionPlan {
	/** Header renders nothing signed out, a checking pill, or the status pill. */
	headerControl: 'none' | 'checking' | 'account';
	/** Connect buttons inside the Machines signed-out panel. */
	machinesConnectButtons: number;
	/** Local tunnel card action: toggle when connected, notice text otherwise. */
	localTunnelAction: 'toggle' | 'notice';
	/** Total `Connect OttoRouter` buttons on the landing page. */
	totalConnectButtons: number;
}

/**
 * Single source of truth for which OttoRouter auth affordances the landing
 * page renders. Exactly one Connect button exists (Machines signed-out
 * panel); the header never shows Connect, and the local tunnel card never
 * carries auth actions.
 */
export function planOttoRouterActions({
	configured,
	initializing,
}: {
	configured: boolean;
	initializing: boolean;
}): OttoRouterActionPlan {
	if (initializing) {
		return {
			headerControl: 'checking',
			machinesConnectButtons: 0,
			localTunnelAction: 'notice',
			totalConnectButtons: 0,
		};
	}
	if (!configured) {
		return {
			headerControl: 'none',
			machinesConnectButtons: 1,
			localTunnelAction: 'notice',
			totalConnectButtons: 1,
		};
	}
	return {
		headerControl: 'account',
		machinesConnectButtons: 0,
		localTunnelAction: 'toggle',
		totalConnectButtons: 0,
	};
}

/** Connect-flow phase owned by the shared account hook, not the data store. */
export type OttoRouterAuthPhase = 'idle' | 'pending' | 'error';

export type MachinesAuthView =
	| 'checking'
	| 'connected'
	| 'waiting'
	| 'auth-error'
	| 'connect';

/**
 * Resolves the Machines signed-out panel view. An active device flow
 * (`phase === 'pending'`) always wins, so account-store refreshes that
 * report `configured:false` while the browser approval is open can never
 * flip the UI back to the Connect button mid-flow.
 */
export function resolveMachinesAuthView({
	configured,
	initializing,
	phase,
}: {
	configured: boolean;
	initializing: boolean;
	phase: OttoRouterAuthPhase;
}): MachinesAuthView {
	if (phase === 'pending') return 'waiting';
	if (configured) return 'connected';
	if (initializing) return 'checking';
	if (phase === 'error') return 'auth-error';
	return 'connect';
}
