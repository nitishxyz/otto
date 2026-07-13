import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getProjectKey } from '../lib/api-client/utils';
import {
	getProjectConnectionState,
	onProjectConnectionState,
	retryProjectConnection,
	type ProjectConnectionState,
} from '../lib/event-stream';

/** Attempts before a dropped connection is reported as disconnected. */
const DISCONNECTED_AFTER_ATTEMPTS = 3;

export type ProjectConnectionStatus =
	| 'connected'
	| 'reconnecting'
	| 'disconnected';

/**
 * Derives the user-facing connection status purely from the raw multiplexer
 * state. `attempt` counts consecutive failed connection attempts, so a fresh
 * connect (`connecting` with attempt 0) is healthy and shows nothing, while
 * accumulated failures escalate reconnecting -> disconnected.
 */
export function deriveProjectConnectionStatus(
	state: ProjectConnectionState,
): ProjectConnectionStatus {
	switch (state.status) {
		case 'connected':
		case 'idle':
		case 'fallback':
			return 'connected';
		case 'connecting':
			if (state.attempt === 0) return 'connected';
			return state.attempt >= DISCONNECTED_AFTER_ATTEMPTS
				? 'disconnected'
				: 'reconnecting';
		case 'retrying':
			return state.attempt >= DISCONNECTED_AFTER_ATTEMPTS
				? 'disconnected'
				: 'reconnecting';
	}
}

/**
 * Active-project connection controller. Subscribes to the multiplexed SSE
 * connection state, exposes a derived status plus a manual retry that runs
 * the full transport/authorization recovery path, and reconciles all
 * event-maintained project queries once per successful reconnect transition.
 */
export function useProjectConnection() {
	const queryClient = useQueryClient();
	const state = useSyncExternalStore(
		onProjectConnectionState,
		getProjectConnectionState,
		getProjectConnectionState,
	);
	const interruptedRef = useRef(false);
	const [retryPending, setRetryPending] = useState(false);

	useEffect(() => {
		if (state.status === 'retrying') {
			interruptedRef.current = true;
			setRetryPending(false);
			return;
		}
		if (state.status === 'connected') {
			setRetryPending(false);
			if (!interruptedRef.current) return;
			interruptedRef.current = false;
			void queryClient.invalidateQueries({
				queryKey: ['project', getProjectKey()],
			});
		}
	}, [state, queryClient]);

	const retry = useCallback(() => {
		setRetryPending(true);
		void retryProjectConnection().catch(() => setRetryPending(false));
	}, []);

	return {
		state,
		status: deriveProjectConnectionStatus(state),
		retry,
		retryPending,
	};
}
