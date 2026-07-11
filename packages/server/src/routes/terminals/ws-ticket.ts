import { createHash, randomBytes } from 'node:crypto';
import { getShareByToken, listTunnelShares } from '../tunnel/shares.ts';

const TICKET_TTL_MS = 30_000;

interface TerminalWebSocketTicket {
	terminalId: string;
	projectId?: string;
	shareId?: string;
	expiresAt: number;
}

const tickets = new Map<string, TerminalWebSocketTicket>();

function digest(value: string): string {
	return createHash('sha256').update(value).digest('base64url');
}

function cleanup(now = Date.now()): void {
	for (const [hash, ticket] of tickets) {
		if (ticket.expiresAt <= now) tickets.delete(hash);
	}
}

/** Mints a one-time terminal WebSocket ticket from an authenticated HTTP request. */
export function createTerminalWebSocketTicket(args: {
	terminalId: string;
	projectId?: string;
	shareToken?: string;
}) {
	cleanup();
	const share = args.shareToken ? getShareByToken(args.shareToken) : undefined;
	if (args.shareToken && !share) throw new Error('Share authorization expired');
	const token = randomBytes(32).toString('base64url');
	tickets.set(digest(token), {
		terminalId: args.terminalId,
		projectId: share?.projectId ?? args.projectId,
		shareId: share?.id,
		expiresAt: Date.now() + TICKET_TTL_MS,
	});
	return { ticket: token, expiresIn: TICKET_TTL_MS / 1000 };
}

/** Atomically consumes a terminal ticket and revalidates its share grant. */
export function consumeTerminalWebSocketTicket(
	token: string,
	terminalId: string,
): { projectId?: string } | undefined {
	cleanup();
	const hash = digest(token);
	const ticket = tickets.get(hash);
	if (!ticket || ticket.terminalId !== terminalId) return undefined;
	tickets.delete(hash);
	if (
		ticket.shareId &&
		!listTunnelShares().some(
			(share) =>
				share.id === ticket.shareId && share.projectId === ticket.projectId,
		)
	) {
		return undefined;
	}
	return { projectId: ticket.projectId };
}

export function clearTerminalWebSocketTickets(): void {
	tickets.clear();
}
