import { createOpenAI } from '@ai-sdk/openai';
import type { OAuth } from '../../types/src/index.ts';
import { refreshOpenAIToken } from '../../auth/src/openai-oauth.ts';
import { setAuth, getAuth } from '../../auth/src/index.ts';
import {
	debug as loggerDebug,
	warn as loggerWarn,
} from '../../core/src/utils/logger.ts';
import os from 'node:os';
import {
	abortableDelay,
	parseIntegerSetting,
	retry,
} from '../../runtime/retry.ts';
import {
	CodexWebSocketTransport,
	isCodexWebSocketRequest,
	resolveOpenAIOAuthTransport,
	type OpenAIOAuthTransport,
	type OpenAIOAuthWebSocketFactory,
} from './openai-oauth-websocket.ts';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_MAX_RETRIES = 2;
const TOKEN_REFRESH_RETRY_DELAY_MS = 1000;
const CODEX_INSTALLATION_ID = crypto.randomUUID();
// The root cause of the old "sits idle forever" hang: we pass `timeout: false`
// to Bun's fetch (see fetchWithCodexRequestTimeout), which disables Bun's
// native socket timeout. If the Codex backend accepts the TCP connection but
// never returns response headers (or the socket silently dies), nothing aborts
// it. These explicit timeouts restore that break. They mirror opencode's
// headerTimeout + chunkTimeout model (packages/opencode/src/provider/provider.ts,
// where OpenAI's headerTimeout default is 10_000ms):
//
//   REQUEST_TIMEOUT  = time to receive response HEADERS (connection liveness).
//                      Cleared the instant fetch() resolves, i.e. before the
//                      body/reasoning streams — so it never kills a legitimate
//                      reasoning turn. This is THE server-break lever: if Codex
//                      doesn't respond, abort fast and let the retry recover,
//                      instead of hanging. opencode uses 10s; we allow a little
//                      headroom for cold starts.
//   STREAM_IDLE      = max silence BETWEEN streamed SSE chunks or WebSocket
//                      events. Resets on every chunk/event. Because we request
//                      `reasoningSummary: 'auto'`, Codex emits reasoning deltas
//                      while it thinks (these render in the UI), so a live turn
//                      keeps resetting this timer; only a genuinely dead stream
//                      trips it.
//
// Both remain overridable via OTTO_OPENAI_OAUTH_REQUEST_TIMEOUT_MS /
// OTTO_OPENAI_OAUTH_STREAM_IDLE_TIMEOUT_MS for tuning.
const CODEX_REQUEST_TIMEOUT_MS = 15_000;
const CODEX_STREAM_IDLE_TIMEOUT_MS = 30_000;
const CODEX_REQUEST_MAX_RETRIES = 2;
const CODEX_REQUEST_RETRY_DELAY_MS = 500;

type OpenAIOAuthSessionState = {
	responseId?: string;
	model?: string;
	status?: string;
	incompleteReason?: string;
};

const openAIOAuthSessionState = new Map<string, OpenAIOAuthSessionState>();
const openAIOAuthWebSocketTransports = new Map<
	string,
	CodexWebSocketTransport
>();
const openAIOAuthHttpFallbackSessions = new Set<string>();

export type OpenAIOAuthConfig = {
	oauth: OAuth;
	projectRoot?: string;
	sessionId?: string;
	transport?: OpenAIOAuthTransport;
	webSocketFactory?: OpenAIOAuthWebSocketFactory;
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
	return parseIntegerSetting(process.env[name], fallback, { min: 1 });
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

function getCodexRequestMaxRetries() {
	return parseIntegerSetting(
		process.env.OTTO_OPENAI_OAUTH_REQUEST_MAX_RETRIES,
		CODEX_REQUEST_MAX_RETRIES,
		{ min: 0 },
	);
}

function getCodexRequestRetryDelayMs() {
	return parseIntegerSetting(
		process.env.OTTO_OPENAI_OAUTH_REQUEST_RETRY_DELAY_MS,
		CODEX_REQUEST_RETRY_DELAY_MS,
		{ min: 0 },
	);
}

export function clearOpenAIOAuthSessionState(sessionId?: string) {
	if (sessionId) {
		openAIOAuthSessionState.delete(sessionId);
		openAIOAuthHttpFallbackSessions.delete(sessionId);
		openAIOAuthWebSocketTransports.get(sessionId)?.close();
		openAIOAuthWebSocketTransports.delete(sessionId);
		return;
	}
	openAIOAuthSessionState.clear();
	openAIOAuthHttpFallbackSessions.clear();
	for (const transport of openAIOAuthWebSocketTransports.values()) {
		transport.close();
	}
	openAIOAuthWebSocketTransports.clear();
}

export function getOpenAIOAuthSessionState(sessionId: string) {
	const state = openAIOAuthSessionState.get(sessionId);
	return state ? { ...state } : undefined;
}

async function refreshAndPersist(
	oauth: OAuth,
	projectRoot?: string,
): Promise<OAuth> {
	return retry(
		async () => {
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
		},
		{
			maxRetries: TOKEN_REFRESH_MAX_RETRIES,
			delayMs: ({ attempt }) => TOKEN_REFRESH_RETRY_DELAY_MS * (attempt + 1),
		},
	).catch((error) => {
		throw error instanceof Error ? error : new Error(String(error));
	});
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

function rewriteRequestBody(
	body: string,
	sessionId?: string,
): { body: string; previousResponseId?: string; model?: string } {
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		const model = typeof parsed.model === 'string' ? parsed.model : undefined;
		let changed = stripStatelessResponseInputIds(parsed);
		if (Array.isArray(parsed.tools)) {
			for (const tool of parsed.tools as unknown[]) {
				if (!tool || typeof tool !== 'object' || Array.isArray(tool)) continue;
				const definition = tool as Record<string, unknown>;
				if (definition.type === 'function' && definition.strict === undefined) {
					// Responses otherwise normalizes optional fields into required ones.
					definition.strict = false;
					changed = true;
				}
			}
		}
		if (!sessionId) {
			return { body: changed ? JSON.stringify(parsed) : body, model };
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

function stripStatelessResponseInputIds(
	parsed: Record<string, unknown>,
): boolean {
	if (parsed.store === true || !Array.isArray(parsed.input)) {
		return false;
	}

	let changed = false;
	const input = parsed.input.map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			return item;
		}
		if (!('id' in item)) {
			return item;
		}

		const next = { ...(item as Record<string, unknown>) };
		delete next.id;
		changed = true;
		return next;
	});

	if (changed) {
		parsed.input = input;
	}

	return changed;
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
			timeout: false,
		});
	}

	// Retry only covers the HEADER phase: fetchCodexRequestAttemptWithTimeout
	// throws if response headers don't arrive within CODEX_REQUEST_TIMEOUT_MS.
	// Once headers arrive we return the response as-is — there is intentionally
	// no first-chunk gate here. A long single reasoning step before the first
	// streamed delta is therefore never cut. Liveness after headers is handled
	// downstream by the between-chunk idle watchdog in trackResponsesStream,
	// whose timer arms at stream start (covering a body that never produces a
	// first chunk) and resets on every SSE/reasoning delta. This matches
	// opencode, which retries on header timeout but applies no post-header
	// first-chunk timeout for OpenAI.
	const maxRetries = getCodexRequestMaxRetries();
	let lastError: unknown;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const attemptStartedAt = Date.now();
		try {
			return await fetchCodexRequestAttemptWithTimeout(url, init, {
				...args,
				requestStartedAt: attemptStartedAt,
			});
		} catch (error) {
			lastError = error;
			if (init.signal?.aborted || attempt >= maxRetries) {
				throw error;
			}

			const retryDelayMs = getCodexRequestRetryDelayMs() * (attempt + 1);
			loggerWarn('[openai-oauth] request attempt failed before headers', {
				sessionId: args.sessionId,
				model: args.model,
				attempt: attempt + 1,
				maxRetries,
				nextAttempt: attempt + 2,
				requestTimeoutMs: getCodexRequestTimeoutMs(),
				streamIdleTimeoutMs: getCodexStreamIdleTimeoutMs(),
				durationMs: Date.now() - attemptStartedAt,
				retryDelayMs,
				error: summarizeError(error),
			});
			await abortableDelay(retryDelayMs, init.signal);
		}
	}

	throw lastError;
}

async function fetchCodexRequestAttemptWithTimeout(
	url: string,
	init: RequestInit,
	args: {
		sessionId?: string;
		model?: string;
		requestStartedAt: number;
	},
) {
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
	}
	return headers;
}

export function createOpenAIOAuthFetch(config: OpenAIOAuthConfig) {
	let currentOAuth = config.oauth;
	const transportMode = resolveOpenAIOAuthTransport(config.transport);
	const createWebSocketTransport = () =>
		new CodexWebSocketTransport({
			connectTimeoutMs: getCodexRequestTimeoutMs,
			idleTimeoutMs: getCodexStreamIdleTimeoutMs,
			persistConnection: Boolean(config.sessionId),
			webSocketFactory: config.webSocketFactory,
			onStreamFailure: () => {
				if (transportMode === 'auto' && config.sessionId) {
					openAIOAuthHttpFallbackSessions.add(config.sessionId);
				}
			},
		});
	const webSocketTransport =
		transportMode === 'http'
			? undefined
			: config.sessionId
				? (() => {
						const existing = openAIOAuthWebSocketTransports.get(
							config.sessionId as string,
						);
						if (existing) return existing;
						const created = createWebSocketTransport();
						openAIOAuthWebSocketTransports.set(
							config.sessionId as string,
							created,
						);
						return created;
					})()
				: createWebSocketTransport();

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
		let responseTransport: 'http' | 'websocket' = 'http';
		try {
			const sessionUsesHttpFallback =
				!!config.sessionId &&
				openAIOAuthHttpFallbackSessions.has(config.sessionId);
			const canUseWebSocket =
				isResponsesRequest &&
				!!webSocketTransport &&
				isCodexWebSocketRequest(requestInit?.body) &&
				(transportMode === 'websocket' || !sessionUsesHttpFallback);

			if (canUseWebSocket) {
				try {
					responseTransport = 'websocket';
					response = await webSocketTransport.request({
						body: requestInit?.body as string,
						headers,
						signal: requestInit?.signal,
						sessionId: config.sessionId,
					});
				} catch (error) {
					if (requestInit?.signal?.aborted || transportMode === 'websocket') {
						throw error;
					}
					if (config.sessionId) {
						openAIOAuthHttpFallbackSessions.add(config.sessionId);
					}
					loggerWarn(
						'[openai-oauth] websocket unavailable, falling back to HTTP',
						{
							sessionId: config.sessionId,
							model: requestModel,
							durationMs: Date.now() - requestStartedAt,
							error: summarizeError(error),
						},
					);
					responseTransport = 'http';
					response = await fetchWithCodexRequestTimeout(
						targetUrl,
						{ ...requestInit, headers },
						{
							enabled: true,
							sessionId: config.sessionId,
							model: requestModel,
							requestStartedAt,
						},
					);
				}
			} else {
				response = await fetchWithCodexRequestTimeout(
					targetUrl,
					{ ...requestInit, headers },
					{
						enabled: isResponsesRequest,
						sessionId: config.sessionId,
						model: requestModel,
						requestStartedAt,
					},
				);
			}
		} catch (error) {
			loggerWarn('[openai-oauth] request failed before response', {
				sessionId: config.sessionId,
				target: isResponsesRequest ? 'codex.responses' : 'other',
				method,
				bodyCharsApprox: requestBodySize,
				model: requestModel,
				transport: responseTransport,
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
			transport: responseTransport,
		});
		if (!response.ok && response.status !== 401) {
			loggerWarn('[openai-oauth] non-OK response', {
				sessionId: config.sessionId,
				target: isResponsesRequest ? 'codex.responses' : 'other',
				status: response.status,
				statusText: response.statusText,
				durationMs: Date.now() - requestStartedAt,
				bodyCharsApprox: requestBodySize,
				model: requestModel,
				transport: responseTransport,
				bodyPreview: await previewResponseBody(response),
			});
		}
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

		const trackedResponse = isResponsesRequest
			? trackResponsesStream(response, config.sessionId)
			: response;

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
