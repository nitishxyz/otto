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
		details.url = actualError.url;
		details.isRetryable = actualError.isRetryable;

		if (actualError.responseBody) {
			details.responseBody = actualError.responseBody;
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

		if (actualError.requestBodyValues) {
			details.requestBodyValues = actualError.requestBodyValues;
		}

		if (actualError.responseHeaders) {
			details.responseHeaders = actualError.responseHeaders;
		}

		if (actualError.cause) {
			const cause = actualError.cause as Record<string, unknown> | undefined;
			details.cause = {
				message: typeof cause?.message === 'string' ? cause.message : undefined,
				code: cause?.code,
				status: cause?.status ?? cause?.statusCode,
			};
		}

		return { message, type: errorType, details };
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

		return { message, type: errorType, details };
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
		details.responseBody = asObj.responseBody;
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
		if ('url' in asObj) details.url = asObj.url;
		if ('isRetryable' in asObj) details.isRetryable = asObj.isRetryable;
		if ('data' in asObj) details.data = asObj.data;

		if (asObj.cause) {
			const c = asObj.cause as Record<string, unknown> | undefined;
			details.cause = {
				message: typeof c?.message === 'string' ? c.message : undefined,
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
		message,
		type: errorType,
		details: Object.keys(details).length ? details : undefined,
	};
}
