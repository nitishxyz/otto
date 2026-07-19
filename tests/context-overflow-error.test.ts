import { describe, expect, test } from 'bun:test';
import { isContextOverflowError } from '../packages/server/src/runtime/errors/context-overflow.ts';

describe('isContextOverflowError', () => {
	test('recognizes explicit context overflow codes and messages', () => {
		expect(isContextOverflowError({ code: 'context_length_exceeded' })).toBe(
			true,
		);
		expect(
			isContextOverflowError({
				responseBody: JSON.stringify({
					error: {
						type: 'invalid_request_error',
						message: 'This model maximum context length is 128000 tokens.',
					},
				}),
			}),
		).toBe(true);
		expect(
			isContextOverflowError({
				error: { error: { message: 'Prompt token count exceeds the limit' } },
			}),
		).toBe(true);
	});

	test('does not classify generic invalid request errors as overflow', () => {
		expect(
			isContextOverflowError({
				apiErrorType: 'invalid_request_error',
				code: 'invalid_prompt',
				message: 'Request blocked.',
			}),
		).toBe(false);
		expect(
			isContextOverflowError({
				type: 'error',
				error: {
					type: 'invalid_request_error',
					code: 'invalid_prompt',
					message: 'Request blocked.',
				},
			}),
		).toBe(false);
	});

	test('does not infer context overflow from generic size or limit errors', () => {
		expect(isContextOverflowError({ message: 'Request too large' })).toBe(
			false,
		);
		expect(isContextOverflowError({ message: 'Rate limit exceeded' })).toBe(
			false,
		);
	});

	test('does not inspect the rejected request body for overflow phrases', () => {
		expect(
			isContextOverflowError({
				code: 'invalid_prompt',
				message: 'Request blocked.',
				requestBodyValues: {
					prompt: 'Explain how the context window limit works.',
				},
			}),
		).toBe(false);
	});
});
