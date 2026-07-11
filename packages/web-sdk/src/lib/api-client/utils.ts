import { client } from '@ottocode/api';
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import {
	getConfiguredRuntimeApiBaseUrl,
	getRuntimeApiBaseUrl,
	getRuntimeProjectContext,
	setRuntimeApiBaseUrl as persistRuntimeApiBaseUrl,
} from '../config';
import { isPlatformDesktop } from '../platform';
import {
	consumeShareBoot,
	getShareAuthHeaders,
	getSharePinnedProjectId,
	isShareMode,
} from '../share-mode';
import { getOwnerSessionHeaders, onOwnerSessionChange } from '../owner-auth';
import type { Session, Message } from '../../types/api';
import { invalidateAuthenticatedAssets } from '../authenticated-asset';
import { renewOwnerSession } from '../owner-renewal';

type ApiSession = Record<string, unknown> & {
	title?: string | null;
	createdAt?: string | number;
	lastActiveAt?: string | number;
	lastViewedAt?: string | number | null;
	pinnedAt?: string | number | null;
};

type RetryableOwnerRequest = InternalAxiosRequestConfig & {
	_ottoOwnerRetried?: boolean;
};

export function shouldRenewOwnerRequest(input: {
	status?: number;
	retried?: boolean;
	shareMode: boolean;
	hasOwnerSession: boolean;
	runtimeBase?: string;
	requestUrl?: string;
}): boolean {
	let isRuntimeRequest = false;
	try {
		const runtime = input.runtimeBase ? new URL(input.runtimeBase) : null;
		const request = input.requestUrl ? new URL(input.requestUrl) : null;
		isRuntimeRequest = Boolean(
			runtime &&
				request &&
				runtime.origin === request.origin &&
				(request.pathname === runtime.pathname ||
					request.pathname.startsWith(
						`${runtime.pathname.replace(/\/$/, '')}/`,
					)),
		);
	} catch {
		isRuntimeRequest = false;
	}
	return Boolean(
		input.status === 401 &&
			!input.retried &&
			!input.shareMode &&
			input.hasOwnerSession &&
			isRuntimeRequest,
	);
}

const axiosClient = axios.create();
axiosClient.interceptors.request.use((request) => {
	const runtimeBase = getConfiguredRuntimeApiBaseUrl();
	const requestUrl = resolveRequestUrl(request, runtimeBase);
	if (
		shouldRenewOwnerRequest({
			status: 401,
			shareMode: isShareMode(),
			hasOwnerSession: Boolean(getRuntimeProjectContext()?.ownerSession),
			runtimeBase,
			requestUrl,
		})
	) {
		for (const [name, value] of Object.entries(getOwnerSessionHeaders())) {
			request.headers.set(name, value);
		}
	}
	return request;
});
axiosClient.interceptors.response.use(undefined, async (error: AxiosError) => {
	const request = error.config as RetryableOwnerRequest | undefined;
	const runtimeBase = getConfiguredRuntimeApiBaseUrl();
	const requestUrl = request
		? resolveRequestUrl(request, runtimeBase)
		: undefined;
	if (
		!request ||
		!shouldRenewOwnerRequest({
			status: error.response?.status,
			retried: request._ottoOwnerRetried,
			shareMode: isShareMode(),
			hasOwnerSession: Boolean(getRuntimeProjectContext()?.ownerSession),
			runtimeBase,
			requestUrl,
		})
	) {
		throw error;
	}
	request._ottoOwnerRetried = true;
	await renewOwnerSession();
	return axiosClient.request(request);
});

function resolveRequestUrl(
	request: Pick<InternalAxiosRequestConfig, 'baseURL' | 'url'>,
	runtimeBase?: string,
): string | undefined {
	try {
		return new URL(
			request.url ?? '',
			request.baseURL || runtimeBase,
		).toString();
	} catch {
		return undefined;
	}
}

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
	// Consume any `?share=` boot token before wiring auth headers so the client
	// attaches the distinct share credential from the very first request.
	consumeShareBoot();

	const configuredBaseUrl = getConfiguredRuntimeApiBaseUrl();
	if (isPlatformDesktop() && !configuredBaseUrl) return;
	const baseURL = configuredBaseUrl ?? getRuntimeApiBaseUrl();
	client.setConfig({
		baseURL,
		axios: axiosClient,
		adapter: getClientAdapter(),
		headers: getAuthHeaders(),
	});
}

configureApiClient();

// Re-apply auth headers whenever the owner session changes so a freshly
// exchanged owner bearer is attached to subsequent API calls (retry/bootstrap).
onOwnerSessionChange(() => {
	invalidateAuthenticatedAssets();
	configureApiClient();
});

export function getBaseUrl(): string {
	return getRuntimeApiBaseUrl();
}

export function getProjectId(): string | undefined {
	// Never fall back to an injected owner project while using a share token.
	if (isShareMode()) {
		return getSharePinnedProjectId();
	}
	return getRuntimeProjectContext()?.projectId;
}

export function getProjectRoot(): string | undefined {
	if (isShareMode()) return undefined;
	return getRuntimeProjectContext()?.projectRoot;
}

export function getAuthHeaders(): Record<string, string> {
	// Share viewers authenticate with the distinct share token only. The server
	// pins their project context from the token, so we never send owner-level
	// daemon credentials or client-supplied project headers in share mode.
	if (isShareMode()) {
		return getShareAuthHeaders();
	}

	const context = getRuntimeProjectContext();
	return {
		...(context?.serverToken
			? {
					Authorization: `Bearer ${context.serverToken}`,
					'X-Otto-Server-Token': context.serverToken,
				}
			: {}),
		// Memory-only owner session (desktop-supplied or established via the setu
		// assertion exchange). Attached over tunnels where no local server token
		// exists; the daemon also honors its Secure HttpOnly cookie same-origin.
		...getOwnerSessionHeaders(),
		...(context?.projectId ? { 'X-Otto-Project-Id': context.projectId } : {}),
		...(context?.projectRoot ? { 'X-Otto-Project': context.projectRoot } : {}),
	};
}

/** Fetches with current runtime auth and renews a remote owner session once. */
export async function authenticatedFetch(
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> {
	const requestUrl =
		typeof input === 'string'
			? new URL(input, getRuntimeApiBaseUrl()).toString()
			: input instanceof URL
				? input.toString()
				: input.url;
	const dispatch = () =>
		fetch(input, {
			...init,
			headers: { ...getAuthHeaders(), ...init?.headers },
		});
	let response = await dispatch();
	if (
		shouldRenewOwnerRequest({
			status: response.status,
			shareMode: isShareMode(),
			hasOwnerSession: Boolean(getRuntimeProjectContext()?.ownerSession),
			runtimeBase: getConfiguredRuntimeApiBaseUrl(),
			requestUrl,
		})
	) {
		await renewOwnerSession();
		response = await dispatch();
	}
	return response;
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
