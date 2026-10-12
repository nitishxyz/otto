import type { AgentSideConnection } from '@agentclientprotocol/sdk';

/** Keep notification order per ACP session without blocking other sessions. */
export function serializeSessionUpdates(
	client: AgentSideConnection,
): AgentSideConnection {
	const pendingBySession = new Map<string, Promise<unknown>>();
	const sessionUpdate: AgentSideConnection['sessionUpdate'] = async (
		notification,
	) => {
		const id = notification.sessionId;
		const pending = (pendingBySession.get(id) ?? Promise.resolve())
			.catch(() => {})
			.then(() => client.sessionUpdate(notification));
		pendingBySession.set(id, pending);
		try {
			return await pending;
		} finally {
			if (pendingBySession.get(id) === pending) pendingBySession.delete(id);
		}
	};
	return new Proxy(client, {
		get(target, property) {
			if (property === 'sessionUpdate') return sessionUpdate;
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}
