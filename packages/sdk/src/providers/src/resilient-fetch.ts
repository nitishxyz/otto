/**
 * Provider-agnostic resilient fetch.
 *
 * - Header timeout: aborts if response headers do not arrive in time.
 * - Bounded retries: only for pre-header timeout / network failures.
 * - Parent abort: forwarded to the in-flight attempt; never retried.
 * - Abort-aware backoff between retries.
 * - Non-replayable ReadableStream bodies are never retried.
 * - SSE idle timeout: only for `text/event-stream`, reset on every raw chunk
 *   (including heartbeats). Cleared on stream end / cancel / error.
 * - Bun `timeout: false` is set centrally so native socket timeouts do not
 *   race our explicit controllers.
 */

import { parseIntegerSetting, retry } from '../../runtime/retry.ts';

export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_PROVIDER_REQUEST_MAX_RETRIES = 2;
export const DEFAULT_PROVIDER_REQUEST_RETRY_DELAY_MS = 500;
export const DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS = 30_000;

const ENV_REQUEST_TIMEOUT_MS = 'OTTO_PROVIDER_REQUEST_TIMEOUT_MS';
const ENV_REQUEST_MAX_RETRIES = 'OTTO_PROVIDER_REQUEST_MAX_RETRIES';
const ENV_REQUEST_RETRY_DELAY_MS = 'OTTO_PROVIDER_REQUEST_RETRY_DELAY_MS';
const ENV_STREAM_IDLE_TIMEOUT_MS = 'OTTO_PROVIDER_STREAM_IDLE_TIMEOUT_MS';

type FetchInput = Parameters<typeof fetch>[0];
type FetchBody = NonNullable<RequestInit['body']>;

/** Fetch-compatible function signature used by AI SDK providers. */
export type FetchLike = (
	input: FetchInput,
	init?: RequestInit,
) => Promise<Response>;

/**
 * Configuration for {@link createResilientFetch} / {@link resilientFetch}.
 * Unset fields fall back to env vars, then built-in defaults.
 */
export type ResilientFetchOptions = {
	/** Max time to wait for response headers (ms). `<= 0` disables. */
	requestTimeoutMs?: number;
	/** Retries after the first attempt for pre-header failures. */
	maxRetries?: number;
	/** Base delay between retries (ms); multiplied by attempt number. */
	retryDelayMs?: number;
	/** Max silence between SSE chunks (ms). `<= 0` disables. */
	streamIdleTimeoutMs?: number;
	/** Underlying fetch implementation (defaults to `globalThis.fetch`). */
	fetch?: FetchLike;
};

/**
 * Error thrown when an SSE body produces no raw chunks within the idle window.
 * `name` is set for structured detection after AI SDK / runtime wrapping.
 */
export class ProviderStreamIdleTimeoutError extends Error {
	override readonly name = 'ProviderStreamIdleTimeoutError';
	readonly idleTimeoutMs: number;

	constructor(idleTimeoutMs: number, message?: string) {
		super(message ?? `Provider stream idle timeout after ${idleTimeoutMs}ms`);
		this.idleTimeoutMs = idleTimeoutMs;
	}
}

const IDLE_TIMEOUT_MESSAGE_MARKER = 'Provider stream idle timeout';

/**
 * Robust predicate for stream idle timeouts, including AI SDK-wrapped errors
 * that nest the original via `cause` / `error` / message text.
 */
export function isProviderStreamIdleTimeoutError(error: unknown): boolean {
	const seen = new Set<unknown>();
	let current: unknown = error;

	while (current != null && !seen.has(current)) {
		seen.add(current);

		if (current instanceof ProviderStreamIdleTimeoutError) {
			return true;
		}

		if (current instanceof Error) {
			if (current.name === 'ProviderStreamIdleTimeoutError') {
				return true;
			}
			if (current.message.includes(IDLE_TIMEOUT_MESSAGE_MARKER)) {
				return true;
			}
			current = current.cause;
			continue;
		}

		if (typeof current === 'object') {
			const obj = current as Record<string, unknown>;
			if (obj.name === 'ProviderStreamIdleTimeoutError') {
				return true;
			}
			if (
				typeof obj.message === 'string' &&
				obj.message.includes(IDLE_TIMEOUT_MESSAGE_MARKER)
			) {
				return true;
			}
			current = obj.cause ?? obj.error ?? obj.originalError;
			continue;
		}

		break;
	}

	return false;
}

function parseIntegerEnv(
	name: string,
	fallback: number,
	opts: { min: number },
): number {
	return parseIntegerSetting(process.env[name], fallback, opts);
}

/** Resolve request header timeout from options / env / default. */
export function getProviderRequestTimeoutMs(override?: number): number {
	if (override !== undefined) return override;
	return parseIntegerEnv(
		ENV_REQUEST_TIMEOUT_MS,
		DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
		{ min: 1 },
	);
}

/** Resolve max pre-header retries from options / env / default. */
export function getProviderRequestMaxRetries(override?: number): number {
	if (override !== undefined) return override;
	return parseIntegerEnv(
		ENV_REQUEST_MAX_RETRIES,
		DEFAULT_PROVIDER_REQUEST_MAX_RETRIES,
		{ min: 0 },
	);
}

/** Resolve base retry delay from options / env / default. */
export function getProviderRequestRetryDelayMs(override?: number): number {
	if (override !== undefined) return override;
	return parseIntegerEnv(
		ENV_REQUEST_RETRY_DELAY_MS,
		DEFAULT_PROVIDER_REQUEST_RETRY_DELAY_MS,
		{ min: 0 },
	);
}

/** Resolve SSE idle timeout from options / env / default. */
export function getProviderStreamIdleTimeoutMs(override?: number): number {
	if (override !== undefined) return override;
	return parseIntegerEnv(
		ENV_STREAM_IDLE_TIMEOUT_MS,
		DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS,
		{ min: 1 },
	);
}

function isReplayableBody(body: RequestInit['body']): boolean {
	if (body == null) return true;
	if (typeof body === 'string') return true;
	if (body instanceof URLSearchParams) return true;
	if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
	if (body instanceof ArrayBuffer) return true;
	if (ArrayBuffer.isView(body)) return true;
	if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
	// ReadableStream (and unknown body types) cannot be safely re-sent.
	return false;
}

/**
 * Returns true when the request body cannot be replayed after a failed attempt.
 * ReadableStream bodies and Request objects that carry a non-replayable body
 * are treated as non-replayable.
 */
export function isNonReplayableRequestBody(
	input: FetchInput,
	init?: RequestInit,
): boolean {
	if (init?.body !== undefined) {
		return !isReplayableBody(init.body);
	}
	if (typeof Request !== 'undefined' && input instanceof Request) {
		// Request bodies are consumed on first fetch; only allow retry when
		// there is no body (GET/HEAD-style) or the body is known-replayable
		// *and* we can clone the Request per attempt.
		if (input.body == null) return false;
		return !isReplayableBody(input.body as FetchBody);
	}
	return false;
}

function isEventStreamContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	return contentType.toLowerCase().includes('text/event-stream');
}

/**
 * Wrap an SSE response body with a between-chunk idle watchdog.
 * Timer resets on every raw chunk (including heartbeats / comments).
 * Non-SSE responses are returned unchanged.
 */
export function withStreamIdleTimeout(
	response: Response,
	idleTimeoutMs: number,
): Response {
	if (idleTimeoutMs <= 0 || !response.body) {
		return response;
	}
	if (!isEventStreamContentType(response.headers.get('content-type'))) {
		return response;
	}

	const reader = response.body.getReader();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let settled = false;

	const clearIdleTimeout = () => {
		if (timeout !== undefined) {
			clearTimeout(timeout);
			timeout = undefined;
		}
	};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const fail = (error: unknown) => {
				if (settled) return;
				settled = true;
				clearIdleTimeout();
				try {
					controller.error(error);
				} catch {
					// Controller may already be closed/errored.
				}
			};

			const resetIdleTimeout = () => {
				clearIdleTimeout();
				timeout = setTimeout(() => {
					const error = new ProviderStreamIdleTimeoutError(idleTimeoutMs);
					void reader.cancel(error).catch(() => {});
					fail(error);
				}, idleTimeoutMs);
			};

			resetIdleTimeout();

			const pump = async () => {
				try {
					while (!settled) {
						const { done, value } = await reader.read();
						if (settled) return;
						if (done) {
							settled = true;
							clearIdleTimeout();
							controller.close();
							return;
						}
						// Reset on every raw chunk, including SSE heartbeats.
						resetIdleTimeout();
						controller.enqueue(value);
					}
				} catch (error) {
					fail(error);
				}
			};

			void pump();
		},
		cancel(reason) {
			settled = true;
			clearIdleTimeout();
			return reader.cancel(reason);
		},
	});

	return new Response(stream, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

async function fetchWithHeaderTimeout(
	fetchImpl: FetchLike,
	input: FetchInput,
	init: RequestInit | undefined,
	requestTimeoutMs: number,
): Promise<Response> {
	const parentSignal = init?.signal ?? undefined;
	const controller = new AbortController();
	let abortedByParent = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;

	const abortFromParent = () => {
		abortedByParent = true;
		controller.abort(parentSignal?.reason);
	};

	if (requestTimeoutMs > 0) {
		timeout = setTimeout(() => {
			controller.abort(
				new Error(
					`Provider request timeout before response after ${requestTimeoutMs}ms`,
				),
			);
		}, requestTimeoutMs);
	}

	if (parentSignal) {
		if (parentSignal.aborted) {
			abortFromParent();
		} else {
			parentSignal.addEventListener('abort', abortFromParent, { once: true });
		}
	}

	try {
		return await fetchImpl(input, {
			...init,
			signal: controller.signal,
			// @ts-expect-error Bun-specific fetch option — disable native socket timeout
			timeout: false,
		});
	} catch (error) {
		if (abortedByParent) {
			throw parentSignal?.reason ?? error;
		}
		throw error;
	} finally {
		if (timeout !== undefined) {
			clearTimeout(timeout);
		}
		if (parentSignal) {
			parentSignal.removeEventListener('abort', abortFromParent);
		}
	}
}

function prepareAttemptInput(input: FetchInput): FetchInput {
	// Clone Request so a prior attempt does not leave bodyUsed locked when
	// the body is replayable (string/buffer/etc.).
	if (typeof Request !== 'undefined' && input instanceof Request) {
		return input.clone() as FetchInput;
	}
	return input;
}

/**
 * Perform a resilient fetch with header timeout, pre-header retries, and
 * optional SSE stream idle timeout.
 */
export async function resilientFetch(
	input: FetchInput,
	init?: RequestInit,
	options?: ResilientFetchOptions,
): Promise<Response> {
	const requestTimeoutMs = getProviderRequestTimeoutMs(
		options?.requestTimeoutMs,
	);
	const configuredMaxRetries = getProviderRequestMaxRetries(
		options?.maxRetries,
	);
	const retryDelayMs = getProviderRequestRetryDelayMs(options?.retryDelayMs);
	const streamIdleTimeoutMs = getProviderStreamIdleTimeoutMs(
		options?.streamIdleTimeoutMs,
	);
	const fetchImpl = options?.fetch ?? globalThis.fetch.bind(globalThis);

	const nonReplayable = isNonReplayableRequestBody(input, init);
	const maxRetries = nonReplayable ? 0 : configuredMaxRetries;
	const parentSignal = init?.signal ?? undefined;

	return retry(
		async () => {
			const attemptInput = prepareAttemptInput(input);
			const response = await fetchWithHeaderTimeout(
				fetchImpl,
				attemptInput,
				init,
				requestTimeoutMs,
			);
			return withStreamIdleTimeout(response, streamIdleTimeoutMs);
		},
		{
			maxRetries,
			delayMs: ({ attempt }) => retryDelayMs * (attempt + 1),
			signal: parentSignal,
		},
	);
}

/**
 * Create a fetch-like function with resilient defaults baked in.
 * Options are resolved per call so env overrides apply without recreating.
 */
export function createResilientFetch(
	options?: ResilientFetchOptions,
): FetchLike {
	return (input, init) => resilientFetch(input, init, options);
}
