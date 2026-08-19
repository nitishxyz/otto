import { webSocketTicketStore } from '../../runtime/websocket-ticket-store.ts';
import { getShareByToken, listTunnelShares } from '../tunnel/shares.ts';

const AUDIENCE = 'terminal';

/** Mints a one-time terminal WebSocket ticket from an authenticated HTTP request. */
export function createTerminalWebSocketTicket(args: {
	terminalId: string;
	projectId?: string;
	shareToken?: string;
}) {
	const share = args.shareToken ? getShareByToken(args.shareToken) : undefined;
	if (args.shareToken && !share) throw new Error('Share authorization expired');
	return webSocketTicketStore.mint({
		audience: AUDIENCE,
		subject: args.terminalId,
		projectId: share?.projectId ?? args.projectId,
		shareId: share?.id,
	});
}

/** Atomically consumes a terminal ticket and revalidates its share grant. */
export function consumeTerminalWebSocketTicket(
	token: string,
	terminalId: string,
): { projectId?: string } | undefined {
	return webSocketTicketStore.consume({
		ticket: token,
		audience: AUDIENCE,
		subject: terminalId,
		isShareActive: (binding) =>
			listTunnelShares().some(
				(share) =>
					share.id === binding.shareId && share.projectId === binding.projectId,
			),
	});
}

export function clearTerminalWebSocketTickets(): void {
	webSocketTicketStore.clearAudience(AUDIENCE);
}
