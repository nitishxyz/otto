import { client } from '@ottocode/api';
import {
	getRuntimeApiBaseUrl,
	getRuntimeProjectContext,
	setRuntimeApiBaseUrl as persistRuntimeApiBaseUrl,
} from '../config';
import type { Session, Message } from '../../types/api';

type ApiSession = Record<string, unknown> & {
	title?: string | null;
	createdAt?: string | number;
	lastActiveAt?: string | number;
	lastViewedAt?: string | number | null;
	pinnedAt?: string | number | null;
};

type ApiMessage = Record<string, unknown> & {
	createdAt?: string | number;
	completedAt?: string | number | null;
};

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
	const baseURL = getRuntimeApiBaseUrl();
	const projectContext = getRuntimeProjectContext();
	client.setConfig({
		baseURL,
		adapter: getClientAdapter(),
		headers: {
			...(projectContext?.serverToken
				? {
						Authorization: `Bearer ${projectContext.serverToken}`,
						'X-Otto-Server-Token': projectContext.serverToken,
					}
				: {}),
			...(projectContext?.projectId
				? { 'X-Otto-Project-Id': projectContext.projectId }
				: {}),
			...(projectContext?.projectRoot
				? { 'X-Otto-Project': projectContext.projectRoot }
				: {}),
		},
	});
}

configureApiClient();

export function getBaseUrl(): string {
	return getRuntimeApiBaseUrl();
}

export function getProjectId(): string | undefined {
	return getRuntimeProjectContext()?.projectId;
}

export function getProjectRoot(): string | undefined {
	return getRuntimeProjectContext()?.projectRoot;
}

export function getAuthHeaders(): Record<string, string> {
	const context = getRuntimeProjectContext();
	return {
		...(context?.serverToken
			? {
					Authorization: `Bearer ${context.serverToken}`,
					'X-Otto-Server-Token': context.serverToken,
				}
			: {}),
		...(context?.projectId ? { 'X-Otto-Project-Id': context.projectId } : {}),
		...(context?.projectRoot ? { 'X-Otto-Project': context.projectRoot } : {}),
	};
}

export function getProjectQuery() {
	const projectId = getProjectId();
	const project = getProjectRoot();
	return {
		...(projectId ? { projectId } : {}),
		...(project ? { project } : {}),
	};
}

export function getProjectKey(): string {
	return getProjectId() || getProjectRoot() || 'default';
}

export function projectScopedKey<T extends readonly unknown[]>(key: T) {
	return ['project', getProjectKey(), ...key] as const;
}

export function setRuntimeApiBaseUrl(value: string): string {
	const baseUrl = persistRuntimeApiBaseUrl(value);
	configureApiClient();
	return baseUrl;
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
		pinnedAt:
			typeof apiSession.pinnedAt === 'string'
				? new Date(apiSession.pinnedAt).getTime()
				: apiSession.pinnedAt,
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
