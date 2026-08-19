/**
 * Unified API error handling
 *
 * Provides consistent error serialization and response formatting
 * across all API endpoints.
 */

import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { ZodError } from 'zod';
import { isDebugEnabled } from '../debug/state.ts';
import { toErrorPayload } from './handling.ts';

/**
 * Standard API error response format
 */
export const apiErrorResponseSchema = z.object({
	error: z.object({
		message: z.string(),
		type: z.string(),
		code: z.string().optional(),
		status: z.number().int().optional(),
		details: z.record(z.string(), z.unknown()).optional(),
		stack: z.string().optional(),
	}),
});

export type APIErrorResponse = {
	error: {
		message: string;
		type: string;
		code?: string;
		status?: ContentfulStatusCode;
		details?: Record<string, unknown>;
		stack?: string;
	};
};

/**
 * Custom API Error class
 */
export class APIError extends Error {
	public readonly code?: string;
	public readonly status: ContentfulStatusCode;
	public readonly type: string;
	public readonly details?: Record<string, unknown>;

	constructor(
		message: string,
		options?:
			| ContentfulStatusCode
			| {
					code?: string;
					status?: ContentfulStatusCode;
					type?: string;
					details?: Record<string, unknown>;
					cause?: unknown;
			  },
	) {
		super(message);
		this.name = 'APIError';
		const normalizedOptions =
			typeof options === 'number' ? { status: options } : options;
		this.code = normalizedOptions?.code;
		this.status = normalizedOptions?.status ?? 500;
		this.type = normalizedOptions?.type ?? 'api_error';
		this.details = normalizedOptions?.details;

		if (normalizedOptions?.cause) {
			this.cause = normalizedOptions.cause;
		}

		// Maintain proper stack trace
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, APIError);
		}
	}
}

export function createRequestValidationError(
	target: string,
	error: ZodError,
): APIError {
	return new APIError('Invalid request', {
		status: 400,
		code: 'invalid_request',
		details: { target, issues: error.issues },
	});
}

/**
 * Serialize any error into a consistent API error response
 *
 * @param err - The error to serialize
 * @returns A properly formatted API error response
 */
export function serializeError(err: unknown): APIErrorResponse {
	// Use existing error payload logic
	const payload = toErrorPayload(err);

	// Unclassified exceptions are server failures. Expected HTTP failures must use
	// APIError (or expose an explicit status/statusCode from a dependency).
	let status: ContentfulStatusCode = 500;

	// Handle APIError instances first
	if (err instanceof APIError) {
		status = err.status;
	} else if (err && typeof err === 'object') {
		const errObj = err as Record<string, unknown>;
		if (typeof errObj.status === 'number') {
			status = errObj.status as ContentfulStatusCode;
		} else if (typeof errObj.statusCode === 'number') {
			status = errObj.statusCode as ContentfulStatusCode;
		} else if (
			errObj.details &&
			typeof errObj.details === 'object' &&
			typeof (errObj.details as Record<string, unknown>).statusCode === 'number'
		) {
			status = (errObj.details as Record<string, unknown>)
				.statusCode as ContentfulStatusCode;
		}
	}

	// Extract code if available
	let code: string | undefined;
	if (err && typeof err === 'object') {
		const errObj = err as Record<string, unknown>;
		if (typeof errObj.code === 'string') {
			code = errObj.code;
		}
	}

	if (err instanceof APIError && err.code) {
		code = err.code;
	}

	// Build response
	const response: APIErrorResponse = {
		error: {
			message: payload.message || 'An error occurred',
			type: payload.type || 'unknown',
			status,
			...(code ? { code } : {}),
			...(payload.details ? { details: payload.details } : {}),
		},
	};

	if (err instanceof APIError && err.details) {
		response.error.details = {
			...(response.error.details ?? {}),
			...err.details,
		};
	}

	// Include stack trace in debug mode
	if (isDebugEnabled() && err instanceof Error && err.stack) {
		response.error.stack = err.stack;
	}

	return response;
}

/**
 * Create an error response with proper HTTP status code
 *
 * @param err - The error to convert
 * @returns Tuple of [APIErrorResponse, HTTP status code]
 */
export function createErrorResponse(
	err: unknown,
): [APIErrorResponse, ContentfulStatusCode] {
	const response = serializeError(err);
	return [response, response.error.status ?? 500];
}

/**
 * Normalize error to ensure it's an Error instance
 *
 * @param err - The error to normalize
 * @returns An Error instance
 */
export function normalizeError(err: unknown): Error {
	if (err instanceof Error) {
		return err;
	}

	if (typeof err === 'string') {
		return new Error(err);
	}

	if (err && typeof err === 'object') {
		const errObj = err as Record<string, unknown>;
		if (typeof errObj.message === 'string') {
			return new Error(errObj.message);
		}
	}

	return new Error('An unknown error occurred');
}

/**
 * Extract error message from any error type
 *
 * @param err - The error to extract message from
 * @returns The error message string
 */
export function getErrorMessage(err: unknown): string {
	if (typeof err === 'string') {
		return err;
	}

	if (err instanceof Error) {
		return err.message;
	}

	if (err && typeof err === 'object') {
		const errObj = err as Record<string, unknown>;
		if (typeof errObj.message === 'string') {
			return errObj.message;
		}
		if (typeof errObj.error === 'string') {
			return errObj.error;
		}
	}

	return 'An unknown error occurred';
}

// Legacy compatibility - AskServiceError alias
export { APIError as AskServiceError };
