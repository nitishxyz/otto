export const OWNER_RENEWAL_WINDOW_MS = 90_000;

export interface OwnerRenewalSession {
	token: string;
	expiresAt: number;
}

export type OwnerRenewalHandler = () => Promise<OwnerRenewalSession>;

let handler: OwnerRenewalHandler | null = null;
let pending: Promise<OwnerRenewalSession> | null = null;

/** Installs the desktop window's memory-only owner renewal broker. */
export function setOwnerRenewalHandler(next: OwnerRenewalHandler | null): void {
	handler = next;
	pending = null;
}

/** Renews once for all concurrent callers. */
export function renewOwnerSession(): Promise<OwnerRenewalSession> {
	if (!handler)
		return Promise.reject(new Error('Owner reconnect is unavailable.'));
	if (!pending) {
		pending = handler().finally(() => {
			pending = null;
		});
	}
	return pending;
}

/** Returns delay until proactive renewal, bounded at zero. */
export function ownerRenewalDelay(expiresAt: number, now = Date.now()): number {
	return Math.max(0, expiresAt - now - OWNER_RENEWAL_WINDOW_MS);
}
