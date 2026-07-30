import { publishClientEvent, publishNotification } from '../../events/bus.ts';
import { scopedSessionKey } from '../projects/scope.ts';

interface SessionAttentionRequest {
	key: string;
	sessionId: string;
	messageId?: string;
	projectRoot?: string;
	title: string;
	body?: string;
}

const pendingAttention = new Map<string, Set<string>>();

/** Tracks a blocking user interaction and announces it to all connected clients. */
export function requireSessionAttention(
	request: SessionAttentionRequest,
): void {
	const sessionKey = scopedSessionKey(request.projectRoot, request.sessionId);
	const pending = pendingAttention.get(sessionKey) ?? new Set<string>();
	pending.add(request.key);
	pendingAttention.set(sessionKey, pending);

	const createdAt = new Date().toISOString();
	publishClientEvent({
		type: 'session.status',
		payload: {
			sessionId: request.sessionId,
			projectRoot: request.projectRoot,
			status: 'needs_attention',
			messageId: request.messageId,
			createdAt,
		},
	});
	publishNotification({
		id: `session-attention:${request.sessionId}:${request.key}`,
		level: 'warning',
		title: request.title,
		body: request.body,
		createdAt,
		source: 'session',
		sessionId: request.sessionId,
		projectRoot: request.projectRoot,
	});
}

/** Clears one blocking interaction and resumes the running session indicator. */
export function resolveSessionAttention(args: {
	key: string;
	sessionId: string;
	messageId?: string;
	projectRoot?: string;
}): void {
	const sessionKey = scopedSessionKey(args.projectRoot, args.sessionId);
	const pending = pendingAttention.get(sessionKey);
	if (!pending?.delete(args.key)) return;
	if (pending.size > 0) return;
	pendingAttention.delete(sessionKey);

	publishClientEvent({
		type: 'session.status',
		payload: {
			sessionId: args.sessionId,
			projectRoot: args.projectRoot,
			status: 'running',
			messageId: args.messageId,
			createdAt: new Date().toISOString(),
		},
	});
}

/** Removes one interaction without announcing a new session status. */
export function discardSessionAttention(args: {
	key: string;
	sessionId: string;
	projectRoot?: string;
}): void {
	const sessionKey = scopedSessionKey(args.projectRoot, args.sessionId);
	const pending = pendingAttention.get(sessionKey);
	if (!pending?.delete(args.key)) return;
	if (pending.size === 0) pendingAttention.delete(sessionKey);
}

export function sessionNeedsAttention(
	sessionId: string,
	projectRoot?: string,
): boolean {
	return (
		(pendingAttention.get(scopedSessionKey(projectRoot, sessionId))?.size ??
			0) > 0
	);
}

export function clearSessionAttention(
	sessionId: string,
	projectRoot?: string,
): void {
	pendingAttention.delete(scopedSessionKey(projectRoot, sessionId));
}
