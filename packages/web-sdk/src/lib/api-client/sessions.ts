import {
	createSession as apiCreateSession,
	listSessions as apiListSessions,
	listMessages as apiListMessages,
	createMessage as apiCreateMessage,
	abortSession as apiAbortSession,
	deleteSession as apiDeleteSession,
	markSessionViewed as apiMarkSessionViewed,
	updateSession as apiUpdateSession,
	getSessionQueue as apiGetSessionQueue,
	removeFromQueue as apiRemoveFromQueue,
	retryMessage as apiRetryMessage,
	buildSessionStreamUrl,
	type Session as ApiSession,
	type CreateSessionData,
	type CreateMessageData,
} from '@ottocode/api';
import type {
	Session,
	Message,
	CreateSessionRequest,
	SendMessageRequest,
	SendMessageResponse,
	UpdateSessionRequest,
	SessionsPage,
} from '../../types/api';
import {
	extractErrorMessage,
	convertSession,
	convertMessage,
	getBaseUrl,
} from './utils';

export const sessionsMixin = {
	async getSessions(): Promise<Session[]> {
		const page = await this.getSessionsPage({ limit: 200 });
		return page.items;
	},

	async getSessionsPage(
		params: { limit?: number; offset?: number } = {},
	): Promise<SessionsPage> {
		const { limit = 50, offset = 0 } = params;
		const response = await apiListSessions({
			query: { limit, offset },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		const data = response.data;
		return {
			items: (data?.items ?? []).map((s) => convertSession(s as ApiSession)),
			hasMore: data?.hasMore ?? false,
			nextOffset: data?.nextOffset ?? null,
		};
	},

	async createSession(data: CreateSessionRequest): Promise<Session> {
		const response = await apiCreateSession({
			body: data as CreateSessionData['body'],
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		if (!response.data) throw new Error('No data returned from create session');
		return convertSession(response.data);
	},

	async updateSession(
		sessionId: string,
		data: UpdateSessionRequest,
	): Promise<Session> {
		const response = await apiUpdateSession({
			path: { sessionId },
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: data as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return convertSession(response.data as ApiSession);
	},

	async markSessionViewed(sessionId: string): Promise<Session> {
		const response = await apiMarkSessionViewed({ path: { sessionId } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return convertSession(response.data as ApiSession);
	},

	async deleteSession(sessionId: string): Promise<{ success: boolean }> {
		const response = await apiDeleteSession({ path: { sessionId } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as { success: boolean };
	},

	async createHandoff(sessionId: string): Promise<{
		session: Session;
		sessionId: string;
		sourceSessionId: string;
		message: string;
	}> {
		const response = await fetch(
			`${getBaseUrl()}/v1/sessions/${encodeURIComponent(sessionId)}/handoff`,
			{ method: 'POST' },
		);
		const data = await response.json().catch(() => null);
		if (!response.ok) throw new Error(extractErrorMessage(data));
		if (!data?.session || !data?.sessionId) {
			throw new Error('No data returned from handoff');
		}
		return {
			session: convertSession(data.session as ApiSession),
			sessionId: String(data.sessionId),
			sourceSessionId: String(data.sourceSessionId),
			message: String(data.message ?? ''),
		};
	},

	async abortSession(sessionId: string): Promise<{ success: boolean }> {
		const response = await apiAbortSession({ path: { sessionId } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as { success: boolean };
	},

	async abortMessage(
		sessionId: string,
		_messageId: string,
	): Promise<{ success: boolean; wasRunning: boolean; messageId: string }> {
		const response = await apiAbortSession({
			path: { sessionId },
		});
		if (response.error) throw new Error('Failed to abort message');
		return response.data as {
			success: boolean;
			wasRunning: boolean;
			messageId: string;
		};
	},

	async getQueueState(sessionId: string): Promise<{
		currentMessageId: string | null;
		queuedMessages: Array<{ messageId: string; position: number }>;
		isRunning: boolean;
	}> {
		const response = await apiGetSessionQueue({ path: { sessionId } });
		if (response.error) throw new Error('Failed to get queue state');
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async removeFromQueue(
		sessionId: string,
		messageId: string,
	): Promise<{
		success: boolean;
		removed: boolean;
		wasQueued?: boolean;
		wasRunning?: boolean;
	}> {
		const response = await apiRemoveFromQueue({
			path: { sessionId, messageId },
		});
		if (response.error) throw new Error('Failed to remove from queue');
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async sendQueuedMessageNow(
		sessionId: string,
		messageId: string,
	): Promise<{
		success: boolean;
		promoted: boolean;
		wasQueued?: boolean;
		wasRunning?: boolean;
		preemptedMessageId?: string | null;
	}> {
		const response = await fetch(
			`${getBaseUrl()}/v1/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(messageId)}/send-now`,
			{ method: 'POST' },
		);
		const data = await response.json().catch(() => null);
		if (!response.ok) throw new Error(extractErrorMessage(data));
		return data as {
			success: boolean;
			promoted: boolean;
			wasQueued?: boolean;
			wasRunning?: boolean;
			preemptedMessageId?: string | null;
		};
	},

	async getMessages(sessionId: string): Promise<Message[]> {
		const response = await apiListMessages({ path: { id: sessionId } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return (response.data || []).map(convertMessage);
	},

	async sendMessage(
		sessionId: string,
		data: SendMessageRequest,
	): Promise<SendMessageResponse> {
		const response = await apiCreateMessage({
			path: { id: sessionId },
			body: data as CreateMessageData['body'],
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as SendMessageResponse;
	},

	getStreamUrl(sessionId: string): string {
		return buildSessionStreamUrl({ baseUrl: getBaseUrl(), sessionId });
	},

	async retryMessage(
		sessionId: string,
		messageId: string,
	): Promise<{ success: boolean; messageId: string }> {
		const response = await apiRetryMessage({
			path: { sessionId, messageId },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},
};
