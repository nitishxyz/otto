import { APICallError } from 'ai';

export type ErrorPayload = {
	message: string;
	type: string;
	details?: Record<string, unknown>;
};

export type ErrorLogPayload = {
	message: string;
	type?: string;
	details?: Record<string, unknown>;
};

const MAX_DETAIL_STRING_CHARS = 2_000;
const MAX_DETAIL_JSON_CHARS = 4_000;
const SAFE_RESPONSE_HEADERS = [
	/^content-type$/,
	/^retry-after(-ms)?$/,
	/^x-request-id$/,
	/^request-id$/,
	/^cf-ray$/,
	/^x-ratelimit-/,
	/^anthropic-ratelimit-/,
];
const SECRET_PATTERNS: Array<[RegExp, string]> = [
	[/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]'],
	[/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[REDACTED]'],
	[
		/(["']?(?:api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^"'\s,&}]+/gi,
		'$1[REDACTED]',
	],
];

/** Redacts credentials that commonly leak into provider error text. */
export function redactSecrets(value: string): string {
	let result = value;
	for (const [pattern, replacement] of SECRET_PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	return result;
}

function boundString(value: string, max = MAX_DETAIL_STRING_CHARS): string {
	const redacted = redactSecrets(value);
	if (redacted.length <= max) return redacted;
	return `${redacted.slice(0, max)}… [truncated ${redacted.length - max} chars]`;
}

function boundUnknown(value: unknown): unknown {
	if (value === undefined || value === null) return value;
	if (typeof value === 'string') return boundString(value);
	if (typeof value !== 'object') return value;
	let json: string;
	try {
		json = JSON.stringify(value);
	} catch {
		return '[unserializable]';
	}
	const redacted = redactSecrets(json);
	if (redacted.length > MAX_DETAIL_JSON_CHARS) {
		return boundString(redacted, MAX_DETAIL_JSON_CHARS);
	}
	try {
		return JSON.parse(redacted) as unknown;
	} catch {
		return redacted;
	}
}

function sanitizeUrl(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		const url = new URL(value);
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		return url.toString();
	} catch {
		return boundString(value, 500);
	}
}

function safeResponseHeaders(
	headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!headers) return undefined;
	const safe: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		const lower = key.toLowerCase();
		if (!SAFE_RESPONSE_HEADERS.some((pattern) => pattern.test(lower))) continue;
		safe[lower] = boundString(String(value), 200);
	}
	return Object.keys(safe).length ? safe : undefined;
}

function requestModel(values: unknown): { model: string } | undefined {
	if (!values || typeof values !== 'object') return undefined;
	const model = (values as { model?: unknown }).model;
	return typeof model === 'string' ? { model } : undefined;
}

export function toErrorMessage(err: unknown): string {
	return toErrorPayload(err).message;
}

export function toErrorLogPayload(err: unknown): ErrorLogPayload {
	const payload = toErrorPayload(err);
	return {
		message: payload.message,
		...(payload.type && payload.type !== 'unknown'
			? { type: payload.type }
			: {}),
		...(payload.details ? { details: payload.details } : {}),
	};
}

export function toErrorPayload(err: unknown): ErrorPayload {
	let actualError = err;
	if (
		err &&
		typeof err === 'object' &&
		'error' in err &&
		Object.keys(err).length === 1
	) {
		actualError = (err as { error: unknown }).error;
	}

	const asObj =
		actualError && typeof actualError === 'object'
			? (actualError as Record<string, unknown>)
			: undefined;
	let message = '';
	let errorType = 'unknown';
	const details: Record<string, unknown> = {};

	if (APICallError.isInstance(actualError)) {
		errorType = 'api_error';
		message = actualError.message || 'API call failed';

		details.name = actualError.name;
		details.statusCode = actualError.statusCode;
		details.url = sanitizeUrl(actualError.url);
		details.isRetryable = actualError.isRetryable;

		if (actualError.responseBody) {
			details.responseBody = boundString(actualError.responseBody);
			try {
				const parsed = JSON.parse(actualError.responseBody);
				if (parsed.error) {
					if (typeof parsed.error === 'string') {
						message = parsed.error;
					} else if (parsed.error.message) {
						message = parsed.error.message;
					}
				}
				if (parsed.error?.type) {
					details.apiErrorType = parsed.error.type;
				}
				if (parsed.error?.code) {
					details.apiErrorCode = parsed.error.code;
				}
			} catch {}
		}

		// Provider request bodies carry prompts/tool payloads; only the model
		// id is kept for client diagnostics.
		const model = requestModel(actualError.requestBodyValues);
		if (model) details.requestBodyValues = model;

		const headers = safeResponseHeaders(actualError.responseHeaders);
		if (headers) details.responseHeaders = headers;

		if (actualError.cause) {
			const cause = actualError.cause as Record<string, unknown> | undefined;
			details.cause = {
				message:
					typeof cause?.message === 'string'
						? boundString(cause.message, 500)
						: undefined,
				code: cause?.code,
				status: cause?.status ?? cause?.statusCode,
			};
		}

		return { message: boundString(message), type: errorType, details };
	}

	if (
		asObj &&
		'type' in asObj &&
		asObj.type === 'error' &&
		'error' in asObj &&
		typeof asObj.error === 'object' &&
		asObj.error
	) {
		const errorObj = asObj.error as Record<string, unknown>;

		if (typeof errorObj.message === 'string') {
			message = errorObj.message;
		}
		if (typeof errorObj.type === 'string') {
			errorType = errorObj.type;
			details.errorType = errorObj.type;
		}
		if (typeof errorObj.code === 'string') {
			details.code = errorObj.code;
		}
		if ('param' in errorObj) {
			details.param = errorObj.param;
		}

		return { message: boundString(message), type: errorType, details };
	}

	if (asObj) {
		if ('name' in asObj && typeof asObj.name === 'string') {
			errorType = asObj.name;
			details.name = asObj.name;
		}

		if ('type' in asObj && typeof asObj.type === 'string') {
			errorType = asObj.type;
			details.type = asObj.type;
		}

		if ('code' in asObj && asObj.code != null) {
			details.code = asObj.code;
		}

		if ('status' in asObj && asObj.status != null) {
			details.status = asObj.status;
		}

		if ('statusCode' in asObj && asObj.statusCode != null) {
			details.statusCode = asObj.statusCode;
		}
	}

	if (asObj && typeof asObj.message === 'string' && asObj.message) {
		message = asObj.message;
	} else if (typeof actualError === 'string') {
		message = actualError;
	} else if (asObj && typeof asObj.error === 'string' && asObj.error) {
		message = asObj.error;
	} else if (
		asObj &&
		typeof asObj.responseBody === 'string' &&
		asObj.responseBody
	) {
		details.responseBody = boundString(asObj.responseBody);
		try {
			const parsed = JSON.parse(asObj.responseBody);
			if (parsed.error) {
				if (typeof parsed.error === 'string') {
					message = parsed.error;
				} else if (typeof parsed.error.message === 'string') {
					message = parsed.error.message;
				} else {
					message = asObj.responseBody;
				}
			} else {
				message = asObj.responseBody;
			}
		} catch {
			message = asObj.responseBody;
		}
	} else if (asObj?.statusCode && asObj.url) {
		message = `HTTP ${String(asObj.statusCode)} error at ${String(asObj.url)}`;
		details.url = asObj.url;
	} else if (asObj?.name) {
		message = String(asObj.name);
	} else {
		message = 'An error occurred';
	}

	if (asObj) {
		if ('url' in asObj) details.url = sanitizeUrl(asObj.url);
		if ('isRetryable' in asObj) details.isRetryable = asObj.isRetryable;
		if ('data' in asObj) details.data = boundUnknown(asObj.data);

		if (asObj.cause) {
			const c = asObj.cause as Record<string, unknown> | undefined;
			details.cause = {
				message:
					typeof c?.message === 'string'
						? boundString(c.message, 500)
						: undefined,
				code: c?.code,
				status: c?.status ?? c?.statusCode,
			};
		}

		if (
			(asObj as { response?: { status?: unknown; statusText?: unknown } })
				?.response?.status
		) {
			details.response = {
				status: (
					asObj as { response?: { status?: unknown; statusText?: unknown } }
				).response?.status,
				statusText: (
					asObj as { response?: { status?: unknown; statusText?: unknown } }
				).response?.statusText,
			};
		}
	}

	return {
		message: boundString(message),
		type: errorType,
		details: Object.keys(details).length ? details : undefined,
	};
}
