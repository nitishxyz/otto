import type { JSONValue } from '@ai-sdk/provider';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';

export type ToModelOutputOptions = { output: unknown; [key: string]: unknown };
export type ToModelOutputFn = (
	options: ToModelOutputOptions,
) => ToolResultOutput;

export function toJsonValue(value: unknown): JSONValue {
	if (value === undefined) return null;
	try {
		return JSON.parse(JSON.stringify(value)) as JSONValue;
	} catch {
		return String(value) as JSONValue;
	}
}

export function unwrapDoubleWrappedArgs(
	input: unknown,
	expectedName: string,
): typeof input {
	if (
		input &&
		typeof input === 'object' &&
		'name' in input &&
		'args' in input &&
		typeof (input as Record<string, unknown>).name === 'string' &&
		typeof (input as Record<string, unknown>).args === 'object' &&
		(input as Record<string, unknown>).args !== null
	) {
		const wrapped = input as { name: string; args: Record<string, unknown> };
		if (
			wrapped.name === expectedName ||
			wrapped.name.replace(/[_-]/g, '') === expectedName.replace(/[_-]/g, '')
		) {
			return wrapped.args as typeof input;
		}
	}
	return input;
}
