import { createHash, randomBytes } from 'node:crypto';

export const DEFAULT_WEBSOCKET_TICKET_TTL_MS = 30_000;

export interface WebSocketTicketBinding {
	audience: string;
	subject: string;
	projectId?: string;
	shareId?: string;
}

interface StoredWebSocketTicket extends WebSocketTicketBinding {
	expiresAt: number;
}

export interface OneTimeWebSocketTicketStoreOptions {
	ttlMs?: number;
	now?: () => number;
	createToken?: () => string;
}

function digest(value: string): string {
	return createHash('sha256').update(value).digest('base64url');
}

export class OneTimeWebSocketTicketStore {
	readonly #tickets = new Map<string, StoredWebSocketTicket>();
	readonly #ttlMs: number;
	readonly #now: () => number;
	readonly #createToken: () => string;

	constructor(options: OneTimeWebSocketTicketStoreOptions = {}) {
		this.#ttlMs = options.ttlMs ?? DEFAULT_WEBSOCKET_TICKET_TTL_MS;
		this.#now = options.now ?? Date.now;
		this.#createToken =
			options.createToken ?? (() => randomBytes(32).toString('base64url'));
	}

	mint(binding: WebSocketTicketBinding): {
		ticket: string;
		expiresIn: number;
	} {
		const now = this.#now();
		this.cleanupExpired(now);
		const ticket = this.#createToken();
		this.#tickets.set(digest(ticket), {
			...binding,
			expiresAt: now + this.#ttlMs,
		});
		return { ticket, expiresIn: this.#ttlMs / 1000 };
	}

	consume(args: {
		ticket: string;
		audience: string;
		subject: string;
		isShareActive?: (binding: {
			shareId: string;
			projectId?: string;
		}) => boolean;
	}): { projectId?: string } | undefined {
		const now = this.#now();
		this.cleanupExpired(now);
		const hash = digest(args.ticket);
		const stored = this.#tickets.get(hash);
		if (
			!stored ||
			stored.expiresAt <= now ||
			stored.audience !== args.audience ||
			stored.subject !== args.subject
		) {
			return undefined;
		}

		this.#tickets.delete(hash);
		if (
			stored.shareId &&
			(!args.isShareActive ||
				!args.isShareActive({
					shareId: stored.shareId,
					projectId: stored.projectId,
				}))
		) {
			return undefined;
		}
		return { projectId: stored.projectId };
	}

	cleanupExpired(now = this.#now()): void {
		for (const [hash, ticket] of this.#tickets) {
			if (ticket.expiresAt <= now) this.#tickets.delete(hash);
		}
	}

	clear(): void {
		this.#tickets.clear();
	}

	clearAudience(audience: string): void {
		for (const [hash, ticket] of this.#tickets) {
			if (ticket.audience === audience) this.#tickets.delete(hash);
		}
	}

	get size(): number {
		return this.#tickets.size;
	}
}

export const webSocketTicketStore = new OneTimeWebSocketTicketStore();
