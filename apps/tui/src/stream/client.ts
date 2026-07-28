import {
	createSSEStream,
	listMessages,
	listPendingSecureInputs,
} from '@ottocode/api';
import { getProjectQuery } from '../api.ts';
import type { Message, PendingSecureInput, SSEEvent } from '../types.ts';

/** Fetches the full message list for a session. */
export async function loadSessionMessages(
	sessionId: string,
): Promise<Message[]> {
	const response = await listMessages({
		path: { id: sessionId },
		query: getProjectQuery(),
	} as never);
	if (response.error) throw new Error(JSON.stringify(response.error));
	return (response.data ?? []) as unknown as Message[];
}

/** Fetches secure-input prompts still awaiting a response. */
export async function loadPendingSecureInputs(
	sessionId: string,
): Promise<PendingSecureInput[]> {
	const response = await listPendingSecureInputs({
		path: { id: sessionId },
		query: getProjectQuery(),
	} as never);
	if (response.error) return [];
	return Array.isArray(response.data?.pending)
		? (response.data.pending as PendingSecureInput[])
		: [];
}

/** Fetches the session queue snapshot (current + queued message ids). */
export async function loadSessionQueueState(
	sessionId: string,
	baseUrl: string,
): Promise<Record<string, unknown> | null> {
	const url = new URL(
		`/v1/sessions/${encodeURIComponent(sessionId)}/queue`,
		baseUrl,
	);
	const projectQuery = getProjectQuery();
	for (const [key, value] of Object.entries(projectQuery)) {
		url.searchParams.set(key, String(value));
	}
	const response = await fetch(url);
	if (!response.ok) return null;
	return (await response.json()) as Record<string, unknown>;
}

/** Extracts queued assistant message ids from a queue payload. */
export function getQueuedMessageIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => {
			if (!item || typeof item !== 'object') return null;
			const record = item as Record<string, unknown>;
			if (typeof record.messageId === 'string') return record.messageId;
			if (typeof record.assistantMessageId === 'string') {
				return record.assistantMessageId;
			}
			return null;
		})
		.filter((id): id is string => id !== null);
}

/** Compares queued ids without discarding their positional order. */
export function hasSameQueuedMessageOrder(
	currentIds: Set<string>,
	nextIds: string[],
): boolean {
	if (currentIds.size !== nextIds.length) return false;
	return [...currentIds].every((id, index) => id === nextIds[index]);
}

/** Clears streaming state only when the completed message is still active. */
export function getStreamingMessageIdAfterTerminalEvent(
	currentMessageId: string | null,
	payload: Record<string, unknown>,
): string | null {
	const terminalMessageId =
		typeof payload.id === 'string'
			? payload.id
			: typeof payload.messageId === 'string'
				? payload.messageId
				: null;
	if (!terminalMessageId || terminalMessageId === currentMessageId) return null;
	return currentMessageId;
}

/** Connects to the session SSE stream and forwards parsed events. */
export async function connectSSE(
	url: string,
	signal: AbortSignal,
	onEvent: (event: SSEEvent) => void,
): Promise<void> {
	const parsedUrl = new URL(url);
	await createSSEStream(
		{
			baseUrl: parsedUrl.origin,
			sessionId: parsedUrl.pathname.split('/').at(-2) ?? '',
			projectId: parsedUrl.searchParams.get('projectId') ?? undefined,
			projectPath: parsedUrl.searchParams.get('project') ?? undefined,
			onEvent: (event) => {
				try {
					onEvent({
						type: event.event ?? 'message',
						payload: JSON.parse(event.data),
					});
				} catch {}
			},
		},
		signal,
	);
}
