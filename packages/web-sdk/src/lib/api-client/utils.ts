import { client } from '@ottocode/api';
import type {
	Session as ApiSession,
	Message as ApiMessage,
} from '@ottocode/api';
import { API_BASE_URL } from '../config';
import type { Session, Message } from '../../types/api';

interface WindowWithAgiServerUrl extends Window {
	OTTO_SERVER_URL?: string;
}

function getClientAdapter(): 'fetch' | undefined {
	if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
		return 'fetch';
	}
	return undefined;
}

export function extractErrorMessage(error: unknown): string {
	if (!error) return 'Unknown error';
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object') {
		const errObj = error as Record<string, unknown>;
		if (errObj.error && typeof errObj.error === 'object') {
			const innerError = errObj.error as Record<string, unknown>;
			if (typeof innerError.message === 'string') return innerError.message;
		}
		if (typeof errObj.error === 'string') return errObj.error;
		if (typeof errObj.message === 'string') return errObj.message;
		try {
			return JSON.stringify(error);
		} catch {
			return 'Error occurred (unable to parse)';
		}
	}
	return 'Unknown error';
}

export function configureApiClient() {
	const win = window as WindowWithAgiServerUrl;
	const baseURL = win.OTTO_SERVER_URL || API_BASE_URL;
	client.setConfig({
		baseURL,
		adapter: getClientAdapter(),
	});
}

configureApiClient();

export function getBaseUrl(): string {
	const win = window as WindowWithAgiServerUrl;
	if (win.OTTO_SERVER_URL) return win.OTTO_SERVER_URL;
	return API_BASE_URL;
}

export function convertSession(apiSession: ApiSession): Session {
	return {
		...apiSession,
		title: apiSession.title ?? null,
		createdAt:
			typeof apiSession.createdAt === 'string'
				? new Date(apiSession.createdAt).getTime()
				: apiSession.createdAt,
		lastActiveAt:
			typeof apiSession.lastActiveAt === 'string'
				? new Date(apiSession.lastActiveAt).getTime()
				: apiSession.lastActiveAt,
		lastViewedAt:
			typeof apiSession.lastViewedAt === 'string'
				? new Date(apiSession.lastViewedAt).getTime()
				: apiSession.lastViewedAt,
	} as Session;
}

export function convertMessage(apiMessage: ApiMessage): Message {
	return {
		...apiMessage,
		createdAt:
			typeof apiMessage.createdAt === 'string'
				? new Date(apiMessage.createdAt).getTime()
				: apiMessage.createdAt,
		completedAt: apiMessage.completedAt
			? typeof apiMessage.completedAt === 'string'
				? new Date(apiMessage.completedAt).getTime()
				: apiMessage.completedAt
			: null,
	} as Message;
}
