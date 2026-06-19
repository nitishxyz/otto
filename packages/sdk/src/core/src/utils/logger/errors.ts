import { isTraceEnabled } from '../debug.ts';

export type SerializedLogError = {
	name?: string;
	message?: string;
	code?: string;
	status?: number;
	statusCode?: number;
	stack?: string;
	cause?: SerializedLogError | string;
};

function serializeCause(
	cause: unknown,
): SerializedLogError | string | undefined {
	if (cause === undefined || cause === null) return undefined;
	if (cause instanceof Error) return serializeErrorForLog(cause);
	if (typeof cause === 'string') return cause;
	if (typeof cause === 'object') {
		const record = cause as Record<string, unknown>;
		if (typeof record.message === 'string' || typeof record.name === 'string') {
			return serializeErrorLikeRecord(record);
		}
	}
	return String(cause);
}

function serializeErrorLikeRecord(
	errObj: Record<string, unknown>,
): SerializedLogError {
	const details: SerializedLogError = {};
	if (typeof errObj.name === 'string') details.name = errObj.name;
	if (typeof errObj.message === 'string') details.message = errObj.message;
	if (typeof errObj.code === 'string') details.code = errObj.code;
	if (typeof errObj.status === 'number') details.status = errObj.status;
	if (typeof errObj.statusCode === 'number')
		details.statusCode = errObj.statusCode;
	if (isTraceEnabled() && typeof errObj.stack === 'string') {
		details.stack = errObj.stack;
	}
	const cause = serializeCause(errObj.cause);
	if (cause !== undefined) details.cause = cause;
	return details;
}

export function serializeErrorForLog(err: Error): SerializedLogError {
	const details = serializeErrorLikeRecord(
		err as unknown as Record<string, unknown>,
	);
	details.name ??= err.name;
	details.message ??= err.message;
	if (isTraceEnabled() && err.stack) details.stack = err.stack;
	return details;
}

export function normalizeLogError(err: unknown): unknown {
	if (!err) return undefined;
	if (err instanceof Error) return serializeErrorForLog(err);
	if (typeof err === 'string') return err;
	if (typeof err === 'object') {
		const errObj = err as Record<string, unknown>;
		const details = serializeErrorLikeRecord(errObj);
		return Object.keys(details).length ? details : errObj;
	}
	return String(err);
}
