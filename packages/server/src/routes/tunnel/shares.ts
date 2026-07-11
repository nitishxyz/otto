export interface TunnelShare {
	id: string;
	projectId: string;
	token: string;
	url: string;
	createdAt: number;
}

const sharesById = new Map<string, TunnelShare>();
const sharesByToken = new Map<string, TunnelShare>();

function createShareToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Buffer.from(bytes).toString('base64url');
}

/** Creates an in-memory project share for a public tunnel URL. */
export function createTunnelShare(
	projectId: string,
	tunnelUrl: string,
): TunnelShare {
	const token = createShareToken();
	const url = new URL(tunnelUrl);
	url.pathname = '/';
	url.search = '';
	url.hash = '';
	url.searchParams.set('share', token);

	const share: TunnelShare = {
		id: crypto.randomUUID(),
		projectId,
		token,
		url: url.toString(),
		createdAt: Date.now(),
	};
	sharesById.set(share.id, share);
	sharesByToken.set(share.token, share);
	return share;
}

/** Lists all active in-memory project shares. */
export function listTunnelShares(): TunnelShare[] {
	return [...sharesById.values()];
}

/** Looks up an active project share by its bearer token. */
export function getShareByToken(token: string): TunnelShare | undefined {
	return sharesByToken.get(token);
}

/** Revokes an active project share by id. */
export function revokeTunnelShare(id: string): boolean {
	const share = sharesById.get(id);
	if (!share) return false;
	sharesById.delete(id);
	sharesByToken.delete(share.token);
	return true;
}

/** Revokes every in-memory project share. */
export function clearTunnelShares(): void {
	sharesById.clear();
	sharesByToken.clear();
}
