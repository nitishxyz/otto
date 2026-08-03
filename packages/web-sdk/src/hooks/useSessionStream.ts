import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { useToolApprovalStore } from '../stores/toolApprovalStore';
import { useSecureInputStore } from '../stores/secureInputStore';
import { acquireActiveSessionStream } from './sessionStreamManager';

/**
 * Subscribes the actively viewed session to its event stream.
 *
 * Event application lives in the hook-free stream engine
 * (`sessionStreamEngine.ts`) managed by `sessionStreamManager.ts`, which keeps
 * engines attached for sessions that are still running in the background so
 * switching sessions never drops streamed chunks. This hook marks the session
 * as active (driving viewer tabs, approvals, and secure-input prompts) and
 * syncs pending approval state from the server.
 */
export function useSessionStream(
	sessionId: string | undefined,
	enabled = true,
) {
	const queryClient = useQueryClient();
	const { setPendingApprovals } = useToolApprovalStore();
	const { setPendingInputs } = useSecureInputStore();

	useEffect(() => {
		if (!sessionId || !enabled) {
			return;
		}

		let cancelled = false;

		// Fetch pending approvals from server for this session
		apiClient
			.getPendingApprovals(sessionId)
			.then((result) => {
				if (cancelled) return;
				if (result.ok && result.pending.length > 0) {
					setPendingApprovals(result.pending);
				} else {
					setPendingApprovals([]);
				}
			})
			.catch(() => {
				if (!cancelled) setPendingApprovals([]);
			});

		apiClient
			.getPendingSecureInputs(sessionId)
			.then((result) => {
				if (cancelled) return;
				if (result.ok && result.pending.length > 0) {
					setPendingInputs(result.pending);
				} else {
					setPendingInputs([]);
				}
			})
			.catch(() => {
				if (!cancelled) setPendingInputs([]);
			});

		const release = acquireActiveSessionStream(sessionId, queryClient);

		return () => {
			cancelled = true;
			release();
		};
	}, [sessionId, enabled, queryClient, setPendingApprovals, setPendingInputs]);
}
