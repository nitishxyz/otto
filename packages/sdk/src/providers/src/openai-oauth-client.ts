import { createOpenAI } from '@ai-sdk/openai';
import type { OAuth } from '../../types/src/index.ts';
import { refreshOpenAIToken } from '../../auth/src/openai-oauth.ts';
import { setAuth, getAuth } from '../../auth/src/index.ts';
import {
	debug as loggerDebug,
	warn as loggerWarn,
} from '../../core/src/utils/logger.ts';
import os from 'node:os';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_MAX_RETRIES = 2;
const TOKEN_REFRESH_RETRY_DELAY_MS = 1000;
const CODEX_INSTALLATION_ID = crypto.randomUUID();
const CODEX_REQUEST_TIMEOUT_MS = 120_000;
const CODEX_STREAM_IDLE_TIMEOUT_MS = 120_000;

type OpenAIOAuthSessionState = {
	responseId?: string;
	model?: string;
	status?: string;
	incompleteReason?: string;
	turnState?: string;
	installationId?: string;
	windowId?: string;
};

const openAIOAuthSessionState = new Map<string, OpenAIOAuthSessionState>();

export type OpenAIOAuthConfig = {
	oauth: OAuth;
	projectRoot?: string;
	sessionId?: string;
};

function shouldDebugOpenAIOAuth() {
	return process.env.OTTO_OPENAI_OAUTH_DEBUG === '1';
}

function logOpenAIOAuth(message: string) {
	if (shouldDebugOpenAIOAuth()) {
		loggerDebug(`[openai-oauth] ${message}`);
	}
}

function summarizeError(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		return { name: error.name, message: error.message };
	}
	if (error && typeof error === 'object') {
		const err = error as Record<string, unknown>;
		return {
			name: typeof err.name === 'string' ? err.name : undefined,
			message: typeof err.message === 'string' ? err.message : undefined,
			code: typeof err.code === 'string' ? err.code : undefined,
		};
	}
	return { message: String(error) };
}

function getBodySize(body: unknown): number | undefined {
	if (typeof body === 'string') return body.length;
	if (body instanceof URLSearchParams) return body.toString().length;
	if (body instanceof Blob) return body.size;
	if (body instanceof ArrayBuffer) return body.byteLength;
	if (ArrayBuffer.isView(body)) return body.byteLength;
	return undefined;
}

async function previewResponseBody(
	response: Response,
): Promise<string | undefined> {
	try {
		const text = await response.clone().text();
		const normalized = text.replace(/\s+/g, ' ').trim();
		if (!normalized) return undefined;
		return normalized.length > 500
			? `${normalized.slice(0, 500)}…`
			: normalized;
	} catch {
		return undefined;
	}
}

function shouldUsePreviousResponseId() {
	return process.env.OTTO_OPENAI_OAUTH_PREVIOUS_RESPONSE_ID === '1';
}

function parsePositiveIntegerEnv(name: string, fallback: number) {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCodexRequestTimeoutMs() {
	return parsePositiveIntegerEnv(
		'OTTO_OPENAI_OAUTH_REQUEST_TIMEOUT_MS',
		CODEX_REQUEST_TIMEOUT_MS,
	);
}

function getCodexStreamIdleTimeoutMs() {
	return parsePositiveIntegerEnv(
		'OTTO_OPENAI_OAUTH_STREAM_IDLE_TIMEOUT_MS',
		CODEX_STREAM_IDLE_TIMEOUT_MS,
	);
}

export function clearOpenAIOAuthSessionState(sessionId?: string) {
	if (sessionId) {
		openAIOAuthSessionState.delete(sessionId);
		return;
	}
	openAIOAuthSessionState.clear();
}

export function getOpenAIOAuthSessionState(sessionId: string) {
	const state = openAIOAuthSessionState.get(sessionId);
	return state ? { ...state } : undefined;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshAndPersist(
	oauth: OAuth,
	projectRoot?: string,
): Promise<OAuth> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt <= TOKEN_REFRESH_MAX_RETRIES; attempt++) {
		try {
			const newTokens = await refreshOpenAIToken(oauth.refresh);
			const updated: OAuth = {
				type: 'oauth',
				access: newTokens.access,
				refresh: newTokens.refresh,
				expires: newTokens.expires,
				accountId: oauth.accountId,
				idToken: newTokens.idToken,
			};
			await setAuth('openai', updated, projectRoot, 'global');
			return updated;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (attempt < TOKEN_REFRESH_MAX_RETRIES) {
				await sleep(TOKEN_REFRESH_RETRY_DELAY_MS * (attempt + 1));
			}
		}
	}
	throw lastError ?? new Error('Token refresh failed');
}

async function ensureValidToken(
	oauth: OAuth,
	projectRoot?: string,
): Promise<{ oauth: OAuth; access: string; accountId?: string }> {
	if (oauth.access && oauth.expires > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
		return { oauth, access: oauth.access, accountId: oauth.accountId };
	}

	try {
		const updated = await refreshAndPersist(oauth, projectRoot);
		return {
			oauth: updated,
			access: updated.access,
			accountId: updated.accountId,
		};
	} catch {
		loggerWarn(
			'[openai-oauth] Token refresh failed after retries, falling back to current token',
		);
		return { oauth, access: oauth.access, accountId: oauth.accountId };
	}
}

function rewriteUrl(url: string): string {
	const parsed = new URL(url);
	if (
		parsed.pathname.includes('/v1/responses') ||
		parsed.pathname.includes('/chat/completions')
	) {
		return CODEX_RESPONSES_URL;
	}
	return url;
}

function readSessionState(sessionId?: string) {
	if (!sessionId) return undefined;
	return openAIOAuthSessionState.get(sessionId);
}

function writeSessionState(sessionId: string, next: OpenAIOAuthSessionState) {
	openAIOAuthSessionState.set(sessionId, next);
}

function mergeSessionState(sessionId: string, next: OpenAIOAuthSessionState) {
	writeSessionState(sessionId, {
		...readSessionState(sessionId),
		...next,
	});
}

function getCodexWindowId(sessionId: string) {
	return `${sessionId}:0`;
}

function rewriteRequestBody(
	body: string,
	sessionId?: string,
): { body: string; previousResponseId?: string; model?: string } {
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		const model = typeof parsed.model === 'string' ? parsed.model : undefined;
		if (!sessionId) {
			return { body, model };
		}

		let changed = false;
		const clientMetadata =
			parsed.client_metadata && typeof parsed.client_metadata === 'object'
				? (parsed.client_metadata as Record<string, unknown>)
				: {};
		if (clientMetadata['x-codex-installation-id'] !== CODEX_INSTALLATION_ID) {
			parsed.client_metadata = {
				...clientMetadata,
				'x-codex-installation-id': CODEX_INSTALLATION_ID,
			};
			changed = true;
		}
		if (typeof parsed.prompt_cache_key !== 'string') {
			parsed.prompt_cache_key = sessionId;
			changed = true;
		}

		const prior = readSessionState(sessionId);
		if (
			prior?.responseId &&
			!parsed.previous_response_id &&
			(!prior.model || !model || prior.model === model)
		) {
			if (!shouldUsePreviousResponseId()) {
				logOpenAIOAuth(
					`not injecting previous_response_id=${prior.responseId} for session=${sessionId} model=${model ?? 'unknown'} because Codex HTTP backend rejects it; enable OTTO_OPENAI_OAUTH_PREVIOUS_RESPONSE_ID=1 only for validation`,
				);
				return { body: changed ? JSON.stringify(parsed) : body, model };
			}
			parsed.previous_response_id = prior.responseId;
			changed = true;
			logOpenAIOAuth(
				`injecting previous_response_id=${prior.responseId} for session=${sessionId} model=${model ?? 'unknown'}`,
			);
			return {
				body: JSON.stringify(parsed),
				previousResponseId: prior.responseId,
				model,
			};
		}

		return { body: changed ? JSON.stringify(parsed) : body, model };
	} catch {
		return { body };
	}
}

function previewText(value: unknown, maxLength = 240): string | undefined {
	if (typeof value !== 'string') return undefined;
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (!normalized) return undefined;
	return normalized.length > maxLength
		? `${normalized.slice(0, maxLength)}…`
		: normalized;
}

function summarizeRequestBody(body: string): string {
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		const input = Array.isArray(parsed.input) ? parsed.input : [];
		const systemMessages = input.filter((item) => {
			if (!item || typeof item !== 'object') return false;
			const role = (item as Record<string, unknown>).role;
			return role === 'system';
		});
		const systemPreview = previewText(
			(systemMessages[0] as Record<string, unknown> | undefined)?.content,
		);
		const instructionsPreview = previewText(parsed.instructions);
		return [
			`model=${typeof parsed.model === 'string' ? parsed.model : 'unknown'}`,
			`instructionsPresent=${typeof parsed.instructions === 'string'}`,
			`instructionsPreview=${instructionsPreview ?? 'none'}`,
			`inputCount=${input.length}`,
			`systemMessageCount=${systemMessages.length}`,
			`firstSystemPreview=${systemPreview ?? 'none'}`,
			`previousResponseId=${typeof parsed.previous_response_id === 'string' ? parsed.previous_response_id : 'none'}`,
		].join(' ');
	} catch {
		return 'unparseable-body';
	}
}

function trackResponseEvent(data: string, sessionId?: string) {
	if (!sessionId) return;

	try {
		const parsed = JSON.parse(data) as Record<string, unknown>;
		const type = typeof parsed.type === 'string' ? parsed.type : undefined;
		const response =
			parsed.response && typeof parsed.response === 'object'
				? (parsed.response as Record<string, unknown>)
				: undefined;
		const responseId =
			typeof response?.id === 'string'
				? response.id
				: typeof parsed.response_id === 'string'
					? parsed.response_id
					: undefined;
		const responseModel =
			typeof response?.model === 'string' ? response.model : undefined;
		const responseStatus =
			typeof response?.status === 'string' ? response.status : undefined;
		const incompleteReason =
			response?.incomplete_details &&
			typeof response.incomplete_details === 'object' &&
			typeof (response.incomplete_details as Record<string, unknown>).reason ===
				'string'
				? ((response.incomplete_details as Record<string, unknown>)
						.reason as string)
				: undefined;

		if (responseId) {
			const prior = readSessionState(sessionId);
			writeSessionState(sessionId, {
				responseId,
				model: responseModel ?? prior?.model,
				status: responseStatus ?? type,
				incompleteReason,
				turnState: prior?.turnState,
				installationId: prior?.installationId,
				windowId: prior?.windowId,
			});
			logOpenAIOAuth(
				`tracked response event type=${type ?? 'unknown'} responseId=${responseId} session=${sessionId} status=${responseStatus ?? 'unknown'} incompleteReason=${incompleteReason ?? 'none'}`,
			);
		}
	} catch {
		// ignore non-JSON data chunks
	}
}

function trackResponsesStream(
	response: Response,
	sessionId?: string,
): Response {
	if (!response.body || !sessionId) {
		return response;
	}

	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = '';
	let timeout: Timer | undefined;
	const idleTimeoutMs = getCodexStreamIdleTimeoutMs();
	const clearIdleTimeout = () => {
		if (timeout) clearTimeout(timeout);
		timeout = undefined;
	};
	const resetIdleTimeout = (controller: TransformStreamDefaultController) => {
		clearIdleTimeout();
		timeout = setTimeout(() => {
			controller.error(
				new Error(
					`OpenAI OAuth Codex stream idle timeout after ${idleTimeoutMs}ms`,
				),
			);
		}, idleTimeoutMs);
	};

	const transform = new TransformStream<Uint8Array, Uint8Array>({
		start(controller) {
			resetIdleTimeout(controller);
		},
		transform(chunk, controller) {
			resetIdleTimeout(controller);
			buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
			let boundary = buffer.indexOf('\n\n');
			while (boundary !== -1) {
				const rawEvent = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);

				const dataLines: string[] = [];
				for (const line of rawEvent.split('\n')) {
					if (line.startsWith('data:')) {
						dataLines.push(line.slice('data:'.length).trimStart());
					}
				}
				const data = dataLines.join('\n');
				if (data && data !== '[DONE]') {
					trackResponseEvent(data, sessionId);
				}

				controller.enqueue(encoder.encode(`${rawEvent}\n\n`));
				boundary = buffer.indexOf('\n\n');
			}
		},
		flush(controller) {
			clearIdleTimeout();
			buffer += decoder.decode().replace(/\r\n/g, '\n');
			if (buffer.length > 0) {
				controller.enqueue(encoder.encode(buffer));
			}
		},
	});

	return new Response(response.body.pipeThrough(transform), {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

async function fetchWithCodexRequestTimeout(
	url: string,
	init: RequestInit,
	args: {
		enabled: boolean;
		sessionId?: string;
		model?: string;
		requestStartedAt: number;
	},
) {
	if (!args.enabled) {
		return fetch(url, {
			...init,
			// @ts-expect-error Bun-specific fetch option
			timeout: false,
		});
	}

	const timeoutMs = getCodexRequestTimeoutMs();
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort(
			new Error(
				`OpenAI OAuth Codex request timeout before response after ${timeoutMs}ms`,
			),
		);
	}, timeoutMs);
	let abortedByParent = false;
	const parentSignal = init.signal;
	const abortFromParent = () => {
		abortedByParent = true;
		controller.abort(parentSignal?.reason);
	};
	if (parentSignal) {
		if (parentSignal.aborted) {
			abortFromParent();
		} else {
			parentSignal.addEventListener('abort', abortFromParent, { once: true });
		}
	}

	try {
		return await fetch(url, {
			...init,
			signal: controller.signal,
			// @ts-expect-error Bun-specific fetch option
			timeout: false,
		});
	} catch (error) {
		if (!abortedByParent && controller.signal.aborted) {
			loggerWarn('[openai-oauth] request timed out before response', {
				sessionId: args.sessionId,
				model: args.model,
				timeoutMs,
				durationMs: Date.now() - args.requestStartedAt,
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		if (parentSignal) {
			parentSignal.removeEventListener('abort', abortFromParent);
		}
	}
}

function buildHeaders(
	init: RequestInit | undefined,
	accessToken: string,
	accountId?: string,
	sessionId?: string,
): Headers {
	const headers = new Headers(init?.headers);
	const prior = readSessionState(sessionId);
	const windowId = sessionId
		? (prior?.windowId ?? getCodexWindowId(sessionId))
		: undefined;
	headers.delete('Authorization');
	headers.delete('authorization');
	headers.set('authorization', `Bearer ${accessToken}`);
	headers.set('originator', 'otto');
	headers.set('x-codex-installation-id', CODEX_INSTALLATION_ID);
	headers.set(
		'User-Agent',
		`otto/1.0 (${os.platform()} ${os.release()}; ${os.arch()})`,
	);
	if (accountId) {
		headers.set('ChatGPT-Account-Id', accountId);
	}
	if (sessionId) {
		headers.set('session_id', sessionId);
		headers.set('thread_id', sessionId);
		headers.set('x-codex-window-id', windowId ?? getCodexWindowId(sessionId));
		if (prior?.turnState) {
			headers.set('x-codex-turn-state', prior.turnState);
		}
	}
	return headers;
}

function trackCodexResponseHeaders(response: Response, sessionId?: string) {
	if (!sessionId) return;
	const turnState = response.headers.get('x-codex-turn-state') ?? undefined;
	if (!turnState) return;
	const windowId = getCodexWindowId(sessionId);
	mergeSessionState(sessionId, {
		turnState,
		installationId: CODEX_INSTALLATION_ID,
		windowId,
	});
	logOpenAIOAuth(
		`tracked x-codex-turn-state for session=${sessionId} window=${windowId}`,
	);
}

export function createOpenAIOAuthFetch(config: OpenAIOAuthConfig) {
	let currentOAuth = config.oauth;

	const customFetch = async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	): Promise<Response> => {
		const requestStartedAt = Date.now();
		const validated = await ensureValidToken(currentOAuth, config.projectRoot);
		currentOAuth = validated.oauth;

		const originalUrl =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const targetUrl = rewriteUrl(originalUrl);
		const isResponsesRequest = targetUrl === CODEX_RESPONSES_URL;
		let requestInit = init;
		let requestModel: string | undefined;
		if (isResponsesRequest && typeof init?.body === 'string') {
			const rewritten = rewriteRequestBody(init.body, config.sessionId);
			requestModel = rewritten.model;
			requestInit =
				rewritten.body !== init.body ? { ...init, body: rewritten.body } : init;
			logOpenAIOAuth(
				`request payload summary: ${summarizeRequestBody(requestInit?.body && typeof requestInit.body === 'string' ? requestInit.body : init.body)}`,
			);
			if (config.sessionId && requestModel) {
				const prior = readSessionState(config.sessionId);
				writeSessionState(config.sessionId, {
					responseId: prior?.responseId,
					model: requestModel,
					status: prior?.status,
					incompleteReason: prior?.incompleteReason,
					turnState: prior?.turnState,
					installationId: prior?.installationId,
					windowId: prior?.windowId,
				});
			}
		}

		const headers = buildHeaders(
			requestInit,
			validated.access,
			validated.accountId,
			config.sessionId,
		);
		const requestBodySize = getBodySize(requestInit?.body);
		const method = requestInit?.method ?? 'POST';
		loggerDebug('[openai-oauth] request start', {
			sessionId: config.sessionId,
			target: isResponsesRequest ? 'codex.responses' : 'other',
			method,
			bodyCharsApprox: requestBodySize,
			model: requestModel,
		});

		let response: Response;
		try {
			response = await fetchWithCodexRequestTimeout(
				targetUrl,
				{
					...requestInit,
					headers,
				},
				{
					enabled: isResponsesRequest,
					sessionId: config.sessionId,
					model: requestModel,
					requestStartedAt,
				},
			);
		} catch (error) {
			loggerWarn('[openai-oauth] request failed before response', {
				sessionId: config.sessionId,
				target: isResponsesRequest ? 'codex.responses' : 'other',
				method,
				bodyCharsApprox: requestBodySize,
				model: requestModel,
				durationMs: Date.now() - requestStartedAt,
				error: summarizeError(error),
			});
			throw error;
		}
		loggerDebug('[openai-oauth] response received', {
			sessionId: config.sessionId,
			target: isResponsesRequest ? 'codex.responses' : 'other',
			status: response.status,
			statusText: response.statusText,
			ok: response.ok,
			durationMs: Date.now() - requestStartedAt,
			bodyCharsApprox: requestBodySize,
			model: requestModel,
		});
		if (isResponsesRequest) {
			trackCodexResponseHeaders(response, config.sessionId);
		}
		if (!response.ok && response.status !== 401) {
			loggerWarn('[openai-oauth] non-OK response', {
				sessionId: config.sessionId,
				target: isResponsesRequest ? 'codex.responses' : 'other',
				status: response.status,
				statusText: response.statusText,
				durationMs: Date.now() - requestStartedAt,
				bodyCharsApprox: requestBodySize,
				model: requestModel,
				bodyPreview: await previewResponseBody(response),
			});
		}
		const trackedResponse = isResponsesRequest
			? trackResponsesStream(response, config.sessionId)
			: response;

		if (response.status === 401) {
			loggerWarn('[openai-oauth] 401 response, refreshing token and retrying', {
				sessionId: config.sessionId,
				target: isResponsesRequest ? 'codex.responses' : 'other',
				durationMs: Date.now() - requestStartedAt,
				bodyCharsApprox: requestBodySize,
				model: requestModel,
			});
			try {
				const refreshedFromDisk = await getAuth('openai', config.projectRoot);
				if (
					refreshedFromDisk?.type === 'oauth' &&
					refreshedFromDisk.access !== validated.access
				) {
					currentOAuth = refreshedFromDisk;
				} else {
					currentOAuth = await refreshAndPersist(
						currentOAuth,
						config.projectRoot,
					);
				}

				const retryHeaders = buildHeaders(
					requestInit,
					currentOAuth.access,
					currentOAuth.accountId,
					config.sessionId,
				);

				const retryStartedAt = Date.now();
				const retryResponse = await fetchWithCodexRequestTimeout(
					targetUrl,
					{
						...requestInit,
						headers: retryHeaders,
					},
					{
						enabled: isResponsesRequest,
						sessionId: config.sessionId,
						model: requestModel,
						requestStartedAt: retryStartedAt,
					},
				);
				if (isResponsesRequest) {
					trackCodexResponseHeaders(retryResponse, config.sessionId);
				}
				loggerDebug('[openai-oauth] retry response received', {
					sessionId: config.sessionId,
					target: isResponsesRequest ? 'codex.responses' : 'other',
					status: retryResponse.status,
					statusText: retryResponse.statusText,
					ok: retryResponse.ok,
					durationMs: Date.now() - retryStartedAt,
					bodyCharsApprox: requestBodySize,
					model: requestModel,
				});
				if (!retryResponse.ok) {
					loggerWarn('[openai-oauth] retry non-OK response', {
						sessionId: config.sessionId,
						target: isResponsesRequest ? 'codex.responses' : 'other',
						status: retryResponse.status,
						statusText: retryResponse.statusText,
						durationMs: Date.now() - retryStartedAt,
						bodyCharsApprox: requestBodySize,
						model: requestModel,
						bodyPreview: await previewResponseBody(retryResponse),
					});
				}
				return isResponsesRequest
					? trackResponsesStream(retryResponse, config.sessionId)
					: retryResponse;
			} catch (error) {
				loggerWarn(
					'[openai-oauth] 401 retry failed, returning original 401 response',
					{
						sessionId: config.sessionId,
						target: isResponsesRequest ? 'codex.responses' : 'other',
						bodyCharsApprox: requestBodySize,
						model: requestModel,
						error: summarizeError(error),
					},
				);
				return response;
			}
		}

		return trackedResponse;
	};

	return customFetch as typeof fetch;
}

export function createOpenAIOAuthModel(
	model: string,
	config: OpenAIOAuthConfig,
) {
	const customFetch = createOpenAIOAuthFetch(config);

	const provider = createOpenAI({
		apiKey: 'chatgpt-oauth',
		baseURL: CODEX_BASE_URL,
		fetch: customFetch,
	});

	return provider.responses(model);
}
