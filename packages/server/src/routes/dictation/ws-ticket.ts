import { webSocketTicketStore } from '../../runtime/websocket-ticket-store.ts';
import { getShareByToken, listTunnelShares } from '../tunnel/shares.ts';

const AUDIENCE = 'dictation';

/** Mints a one-time dictation WebSocket ticket for an authenticated session. */
export function createDictationWebSocketTicket(args: {
	sessionId: string;
	projectId?: string;
	shareToken?: string;
}) {
	const share = args.shareToken ? getShareByToken(args.shareToken) : undefined;
	if (args.shareToken && !share) throw new Error('Share authorization expired');
	return webSocketTicketStore.mint({
		audience: AUDIENCE,
		subject: args.sessionId,
		projectId: share?.projectId ?? args.projectId,
		shareId: share?.id,
	});
}

/** Atomically consumes a dictation ticket and revalidates its share grant. */
export function consumeDictationWebSocketTicket(
	token: string,
	sessionId: string,
): { projectId?: string } | undefined {
	return webSocketTicketStore.consume({
		ticket: token,
		audience: AUDIENCE,
		subject: sessionId,
		isShareActive: (binding) =>
			listTunnelShares().some(
				(share) =>
					share.id === binding.shareId && share.projectId === binding.projectId,
			),
	});
}

export function clearDictationWebSocketTickets(): void {
	webSocketTicketStore.clearAudience(AUDIENCE);
}
